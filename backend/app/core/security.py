"""Supabase JWT 검증 헬퍼 (스텁).

인증은 Supabase Auth 가 담당한다. 백엔드는 프론트가 보낸 JWT 를 '검증만' 한다.
실제 구현 시 Supabase 프로젝트의 JWT secret / JWKS 로 토큰을 검증하고
사용자 클레임을 반환하도록 채운다. (예: pyjwt 사용)
"""

from app.core.config import settings  # noqa: F401  (실제 검증 시 SUPABASE_* 사용)


def verify_token(token: str) -> dict | None:
    """Supabase JWT 를 검증해 클레임(dict)을 반환. 지금은 스텁이라 항상 None."""
    # TODO(auth): pyjwt 등으로 settings.SUPABASE_* 기반 검증 구현
    return None
