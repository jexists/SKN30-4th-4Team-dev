import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  (ERD 모델 메타데이터 등록)
from app.api.routes import analysis, auth, chat, documents, health, me, notification
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import setup_logging
from app.core.security import describe_verification_mode
from app.db.base import Base
from app.db.session import AppSessionLocal, engine
from app.services.retrieval import close_pool as close_retrieval_pool

setup_logging()
log = logging.getLogger(__name__)
log.info("JWT 검증 모드: %s", describe_verification_mode())


def _warmup() -> None:
    """백그라운드 워밍업 — 챗봇 엔진(LangGraph 컴파일) + 임베딩 모델(KURE-v1 ~2GB).

    첫 /api/v1/chat 이 이 비용(수~수십 초)을 물지 않게 미리 데운다. 여기서 무엇이 실패해도
    서버는 그대로 서비스해야 하므로 두 단계를 각각 감싼다(하나가 죽어도 다른 하나는 데운다).
    엔진을 먼저 하는 이유: 모델 다운로드가 몇 분 걸릴 수 있어서, 뒤에 두면 그동안 엔진이
    준비되지 않는다. import 를 함수 안에 두는 이유: main import 를 가볍게 유지하고,
    테스트가 모듈 속성만 갈아끼워도 스파이가 먹히게 하려는 것.
    """
    try:
        from app.api.routes.chat import prewarm_engine

        prewarm_engine()
    except Exception:
        log.exception("챗봇 엔진 기동 워밍업 실패 — 서비스는 계속한다")

    try:
        # 벡터 DB 가 없으면 search_similar 이 임베딩 전에 빈 결과로 빠진다 → 모델도 무의미.
        if not settings.vector_db_dsn:
            log.info("벡터 DB 미설정 — 임베딩 모델 워밍업 생략(검색 비활성)")
            return
        from app.services.ingestion.embedder import warmup as warmup_embedder

        warmup_embedder()
    except Exception:
        log.exception("임베딩 모델 기동 워밍업 실패 — 서비스는 계속한다")


def _recover_analysis_jobs() -> None:
    """이전 프로세스가 남긴 분석 작업을 정리한다.

    업로드 원본이 임시 디렉터리에만 있어 재시작하면 사라진다 — 되살릴 수 없으므로 재큐잉이
    아니라 FAILED 로 닫고 사용자에게 실패 알림을 보낸다. 워밍업과 마찬가지로 **실패해도
    기동을 막지 않는다**(DB 가 잠깐 안 되더라도 서버는 떠야 한다).
    """
    if AppSessionLocal is None:
        return
    try:
        from app.services.analysis_jobs.runner import recover_on_startup

        with AppSessionLocal() as db:
            recover_on_startup(db)
    except Exception:
        log.exception("중단된 분석 작업 정리 실패 — 서비스는 계속한다")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """기동/종료 훅. 무거운 초기화는 데몬 스레드로 넘겨 startup 을 절대 막지 않는다.

    asyncio.to_thread 를 쓰면 종료 시 asyncio 가 기본 executor 를 join 하므로
    (CPython 3.12: THREAD_JOIN_TIMEOUT=300초) 로드 도중 Ctrl+C·--reload 저장이 그만큼 멈춘다.
    데몬 스레드는 프로세스와 함께 즉시 사라져 개발 루프를 방해하지 않는다.
    """
    if settings.WARMUP_ON_STARTUP:
        threading.Thread(target=_warmup, name="warmup", daemon=True).start()
    else:
        log.info("기동 워밍업 비활성(WARMUP_ON_STARTUP=false) — 첫 채팅 요청이 모델을 로드한다")

    if settings.ANALYSIS_WORKER_ENABLED:
        _recover_analysis_jobs()
        try:
            from app.services.analysis_jobs.runner import worker as analysis_worker

            analysis_worker.start()
        except Exception:
            log.exception("분석 워커 기동 실패 — 분석 요청이 QUEUED 로 쌓인다")
    else:
        log.info("분석 워커 비활성(ANALYSIS_WORKER_ENABLED=false)")

    try:
        yield
    finally:
        try:
            from app.services.analysis_jobs.runner import worker as analysis_worker

            analysis_worker.stop()
        except Exception:
            log.exception("분석 워커 종료 실패")
        # 우리가 잡고 있던 DB 커넥션과 psycopg 워커 스레드를 명시적으로 반납한다.
        # 없으면 --reload 재시작마다 Supabase pooler 슬롯이 timeout 까지 좀비로 남는다.
        close_retrieval_pool()
        engine.dispose()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

# 뼈대용 — SQLite 폴백일 때만. Postgres 스키마는 sql/schema.sql 이 소유하며,
# import 시점 DDL 은 운영 DB 에 리플렉션 커넥션을 상주시킨다(--reload 마다 누적).
# 새 테이블은 create_all 이 아니라 sql/schema.sql 에 DDL 을 추가해서 반영한다.
if settings.is_sqlite:
    Base.metadata.create_all(bind=engine)

app.include_router(health.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
app.include_router(analysis.router, prefix="/api/v1")
app.include_router(notification.router, prefix="/api/v1")
