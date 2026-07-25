"""현재 사용자 조회 — 인증 검증이 실제로 동작하는지 보여주는 보호 엔드포인트.

로그인/회원가입 엔드포인트가 아니다(그건 Supabase Auth 담당). 프론트가 보낸
액세스 토큰(JWT)을 백엔드가 검증한 뒤, 그 클레임에서 사용자 요약을 돌려준다.
"""

from fastapi import APIRouter

from app.api.deps import RequireUser
from app.schemas.auth import MeResponse
from app.schemas.common import ApiResponse, success_response
from app.services.auth import get_current_user_summary

router = APIRouter(tags=["auth"])


@router.get("/me", response_model=ApiResponse[MeResponse])
def me(user: RequireUser) -> ApiResponse[MeResponse]:
    """현재 로그인한 사용자 정보. 미인증이면 require_user 가 401 을 던진다."""
    return success_response(get_current_user_summary(user))
