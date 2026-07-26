import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  (ERD 모델 메타데이터 등록)
from app.api.routes import chat, documents, health, me
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import setup_logging
from app.core.security import describe_verification_mode
from app.db.base import Base
from app.db.session import engine

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
    yield


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

# 뼈대용 — models 가 채워지면 테이블 생성. 실제 ERD 확정 후 Alembic 마이그레이션으로 대체.
Base.metadata.create_all(bind=engine)

app.include_router(health.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(me.router, prefix="/api/v1")
app.include_router(documents.router, prefix="/api/v1")
