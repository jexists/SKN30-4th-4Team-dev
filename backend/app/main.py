from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  (ERD 모델 메타데이터 등록)
from app.api.routes import health
from app.core.config import settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import setup_logging
from app.db.base import Base
from app.db.session import engine

setup_logging()

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
