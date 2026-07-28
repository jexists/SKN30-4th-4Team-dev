"""legal_chunks pgvector 코사인 검색.

쿼리 임베딩은 적재와 동일한 KURE-v1(services.ingestion.embedder)로 만든다.
반환 형식은 graph_rag 가 기대하는 `{**metadata, content, similarity}` (metadata 키는 문서마다 다름).
연결·검색 실패는 예외를 던지지 않고 빈 리스트로 우회해 대화가 끊기지 않게 한다(fail-soft).

⚠️ 커넥션은 반드시 모듈 단위 풀에서 빌린다. 검색마다 psycopg.connect 를 새로 열면
TCP+TLS+auth 핸드셰이크 비용에 더해, SQLAlchemy 풀과 **별개로** Supabase pooler 슬롯을
상한 없이(스레드풀 크기만큼) 먹는다. 예산은 settings.RAG_POOL_MAX_SIZE 로 묶는다.
"""

from __future__ import annotations

import logging
import threading

from psycopg_pool import ConnectionPool

from app.core.config import settings
from app.services.ingestion.embedder import embed_query

log = logging.getLogger(__name__)

TABLE = "legal_chunks"

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()


def _get_pool() -> ConnectionPool | None:
    """검색용 커넥션 풀(지연 생성). 벡터 DB 미설정이면 None.

    락으로 감싸 동시 최초 호출에서도 풀이 한 번만 만들어지게 한다.
    """
    global _pool
    if _pool is not None:
        return _pool
    dsn = settings.vector_db_dsn
    if not dsn:
        return None  # 벡터 DB 미설정 → 검색 비활성
    with _pool_lock:
        if _pool is None:
            pool = ConnectionPool(
                dsn,
                min_size=0,  # 유휴 시 슬롯을 하나도 잡지 않는다
                max_size=settings.RAG_POOL_MAX_SIZE,
                timeout=settings.DB_POOL_TIMEOUT_SECONDS,
                max_idle=settings.RAG_POOL_MAX_IDLE_SECONDS,
                max_lifetime=settings.RAG_POOL_MAX_LIFETIME_SECONDS,
                # 빌려줄 때 살아있는 커넥션인지 확인(SQLAlchemy 의 pool_pre_ping 대응)
                check=ConnectionPool.check_connection,
                kwargs={
                    # Supavisor transaction mode 대비 — db/session.py 와 같은 이유.
                    "prepare_threshold": None,
                    "connect_timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
                    "application_name": "skn30-backend-rag",
                },
                open=False,  # psycopg_pool 3.2+ 는 생성자 open 을 deprecate
            )
            pool.open()
            _pool = pool
    return _pool


def close_pool() -> None:
    """풀을 닫고 전역 참조를 되돌린다(멱등).

    앱 종료·--reload 재시작에서 psycopg 워커 스레드와 커넥션을 명시적으로 정리한다.
    참조를 None 으로 되돌리므로 다음 lifespan 이 닫힌 풀을 재사용하지 않는다.
    """
    global _pool
    with _pool_lock:
        pool, _pool = _pool, None
    if pool is not None:
        try:
            pool.close()
        except Exception:
            log.exception("legal_chunks 검색 풀 종료 실패")


def _vec_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


def search_similar(
    query: str,
    k: int = 12,
    min_score: float = 0.15,
    issues: list[str] | None = None,
) -> list[dict]:
    """query 와 코사인 유사한 청크 상위 k개. min_score 미만은 제외.

    issues 를 주면 해당 쟁점(issue 컬럼)으로 필터한다(USE_FILTERS 경로).
    """
    # 풀 확보를 임베딩보다 **먼저** — 벡터 DB 가 없으면 2GB 모델을 돌릴 이유가 없다.
    # 풀 생성(DSN 파싱·open)도 실패할 수 있으므로 fail-soft 경계 안에 둔다.
    try:
        pool = _get_pool()
    except Exception:
        log.exception("legal_chunks 검색 풀 생성 실패")
        return []
    if pool is None:
        return []  # 벡터 DB 미설정 → 검색 비활성 (graph_rag 가 근거 없이 진행)

    try:
        vec = _vec_literal(embed_query(query))
    except Exception:
        log.exception("쿼리 임베딩 실패")
        return []

    where = ""
    params: dict = {"q": vec, "k": k}
    if issues:
        where = "WHERE issue = ANY(%(issues)s)"
        params["issues"] = list(issues)

    # 코사인 거리(<=>)로 정렬, similarity = 1 - 거리
    sql = f"""
        SELECT content, metadata, 1 - (embedding <=> %(q)s::vector) AS similarity
        FROM {TABLE}
        {where}
        ORDER BY embedding <=> %(q)s::vector
        LIMIT %(k)s
    """

    # 풀 대기(PoolTimeout)·연결·쿼리 실패를 한 경계에서 잡아 빈 결과로 우회한다.
    try:
        with pool.connection() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    except Exception:
        log.exception("legal_chunks 검색 실패")
        return []

    hits: list[dict] = []
    for content, metadata, similarity in rows:
        if similarity is None or float(similarity) < min_score:
            continue
        meta = metadata or {}
        hits.append({**meta, "content": content, "similarity": float(similarity)})
    return hits
