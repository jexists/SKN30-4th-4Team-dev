"""카카오 OAuth 이후 회원 상태 확인과 앱 회원가입."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.api.deps import RequireUser
from app.db.session import get_app_db
from app.schemas.common import ApiResponse, success_response
from app.schemas.kakao_auth import (
    KakaoAuthResponse,
    KakaoSignUpRequest,
    RegistrationResponse,
)
from app.services.kakao_auth import (
    complete_kakao_signup,
    process_kakao_login,
    registration_status,
)

router = APIRouter(prefix="/auth", tags=["auth"])
AppDb = Annotated[Session, Depends(get_app_db)]


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _device(request: Request) -> str | None:
    value = request.headers.get("user-agent", "").strip()
    return value[:500] or None


@router.get(
    "/registration",
    response_model=ApiResponse[RegistrationResponse],
)
def get_registration(user: RequireUser, db: AppDb) -> ApiResponse[RegistrationResponse]:
    return success_response(registration_status(user, db))


@router.post(
    "/kakao/login",
    response_model=ApiResponse[KakaoAuthResponse],
)
def kakao_login(
    request: Request,
    user: RequireUser,
    db: AppDb,
) -> ApiResponse[KakaoAuthResponse]:
    result = process_kakao_login(
        user,
        db,
        client_ip=_client_ip(request),
        device=_device(request),
    )
    return success_response(result)


@router.post(
    "/signup",
    response_model=ApiResponse[KakaoAuthResponse],
    status_code=status.HTTP_201_CREATED,
)
def signup(
    body: KakaoSignUpRequest,
    request: Request,
    user: RequireUser,
    db: AppDb,
) -> ApiResponse[KakaoAuthResponse]:
    result = complete_kakao_signup(
        user,
        body,
        db,
        client_ip=_client_ip(request),
        device=_device(request),
    )
    return success_response(result, "회원가입이 완료되었습니다.", 201)
