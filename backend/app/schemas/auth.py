from datetime import datetime

from pydantic import BaseModel


class MeResponse(BaseModel):
    """현재 로그인한 사용자 요약 — Supabase JWT 클레임에서 뽑아낸다."""

    id: str  # Supabase user id (JWT sub)
    email: str | None = None
    role: str | None = None
    nickname: str | None = None


class WithdrawalResponse(BaseModel):
    """회원 탈퇴 결과. Soft Delete 라 계정 행은 남고 표시만 바뀐다."""

    id: str
    deleted_at: datetime
