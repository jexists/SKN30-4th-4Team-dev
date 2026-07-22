"""legal_chunks pgvector 코사인 검색.

쿼리 임베딩은 적재와 동일한 KURE-v1(services.ingestion.embedder)로 만든다.
반환 형식은 graph_rag 가 기대하는 `{**metadata, content, similarity}` (metadata 키는 문서마다 다름).
연결·검색 실패는 예외를 던지지 않고 빈 리스트로 우회해 대화가 끊기지 않게 한다.
"""

from __future__ import annotations

import logging

from app.core.config import settings
from app.services.ingestion.embedder import embed_query

log = logging.getLogger(__name__)

TABLE = "legal_chunks"


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
    dsn = settings.vector_db_dsn
    if not dsn:
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

    try:
        import psycopg

        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
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
