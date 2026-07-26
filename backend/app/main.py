import logging

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

# 어떤 방식으로 JWT 를 검증할 수 있는 상태인지 기동 즉시 알린다 — .env 가 어긋나면
# 모든 보호 엔드포인트가 조용히 401 이 되므로, 그 사실을 로그에서 바로 보이게 한다.
logging.getLogger(__name__).info("JWT 검증 모드: %s", describe_verification_mode())

app = FastAPI(title=settings.APP_NAME)

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
