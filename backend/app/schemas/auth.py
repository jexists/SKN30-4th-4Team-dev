from pydantic import BaseModel


class MeResponse(BaseModel):
    """현재 로그인한 사용자 요약 — Supabase JWT 클레임에서 뽑아낸다."""

    id: str  # Supabase user id (JWT sub)
    email: str | None = None
    role: str | None = None
    nickname: str | None = None
