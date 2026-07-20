from typing import Annotated

from fastapi import Header

from app.core.security import verify_token


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> dict | None:
    """Authorization 헤더의 Bearer 토큰을 검증해 현재 사용자(클레임)를 반환.

    지금은 스텁 — 검증기(verify_token)가 None 을 돌려줌.
    Supabase Auth 연동 시 verify_token 을 채우고, 보호가 필요한 엔드포인트는
    미인증(None)일 때 401 을 던지도록 확장한다.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1]
    return verify_token(token)
