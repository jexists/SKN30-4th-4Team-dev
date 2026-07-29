"""현재 사용자 조회·회원 탈퇴 — 인증 검증이 실제로 동작하는지 보여주는 보호 엔드포인트.

로그인/회원가입 엔드포인트가 아니다(그건 Supabase Auth 담당). 프론트가 보낸
액세스 토큰(JWT)을 백엔드가 검증한 뒤, 그 클레임에서 사용자 요약을 돌려준다.

두 엔드포인트 모두 RequireMember 를 쓴다. JWT 만 유효한 것으로는 부족하고
**탈퇴하지 않은 가입 회원**이어야 한다 — 탈퇴 계정이 정상 회원처럼 조회되면 안 된다.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import RequireMember
from app.db.session import get_app_db
from app.schemas.auth import MeResponse, WithdrawalResponse
from app.schemas.common import ApiResponse, success_response
from app.services.auth import get_current_user_summary, withdraw_member

router = APIRouter(tags=["auth"])
AppDb = Annotated[Session, Depends(get_app_db)]


@router.get("/me", response_model=ApiResponse[MeResponse])
def me(user: RequireMember) -> ApiResponse[MeResponse]:
    """현재 로그인한 사용자 정보. 미인증이면 401, 미가입·탈퇴 회원이면 403."""
    return success_response(get_current_user_summary(user))


@router.delete("/me", response_model=ApiResponse[WithdrawalResponse])
def withdraw(user: RequireMember, db: AppDb) -> ApiResponse[WithdrawalResponse]:
    """회원 탈퇴(Soft Delete). 대화·계약서 데이터는 지우지 않고 계정만 잠근다."""
    return success_response(withdraw_member(user, db), "회원 탈퇴가 완료되었습니다.")
