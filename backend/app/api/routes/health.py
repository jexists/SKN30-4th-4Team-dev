from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])

DbSession = Annotated[Session, Depends(get_db)]


@router.get("/health", response_model=ApiResponse[HealthResponse])
def health(db: DbSession) -> ApiResponse[HealthResponse]:
    """서버 + DB 연결 상태 확인 (표준 응답 봉투)."""
    db.execute(text("SELECT 1"))
    return success_response(HealthResponse(status="ok", db="ok"))


@router.get("/hello", response_model=ApiResponse[dict])
def hello() -> ApiResponse[dict]:
    # 데모용 — 실제 개발 시작하면 삭제
    return success_response({"message": "안녕하세요! SKN30-4th-4Team API 입니다."})
