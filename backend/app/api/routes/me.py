"""현재 사용자 조회·회원 탈퇴 — 인증 검증이 실제로 동작하는지 보여주는 보호 엔드포인트.

로그인/회원가입 엔드포인트가 아니다(그건 Supabase Auth 담당). 프론트가 보낸
액세스 토큰(JWT)을 백엔드가 검증한 뒤, 그 클레임에서 사용자 요약을 돌려준다.

두 엔드포인트 모두 RequireMember 를 쓴다. JWT 만 유효한 것으로는 부족하고
**탈퇴하지 않은 가입 회원**이어야 한다 — 탈퇴 계정이 정상 회원처럼 조회되면 안 된다.
"""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import RequireMember
from app.core.config import settings
from app.core.exceptions import AppError
from app.db.session import get_app_db
from app.repositories.auth import AuthRepository
from app.schemas.auth import (
    MeResponse,
    UpdateNicknameIn,
    UpdateNotificationPrefIn,
    WithdrawalResponse,
)
from app.schemas.common import ApiResponse, success_response
from app.services.auth import (
    get_current_user_summary,
    update_avatar,
    update_nickname,
    update_notification_pref,
    withdraw_member,
)

router = APIRouter(tags=["auth"])
AppDb = Annotated[Session, Depends(get_app_db)]

_AVATAR_SUFFIXES = frozenset({".png", ".jpg", ".jpeg", ".webp"})
_AVATAR_CONTENT_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


@router.get("/me", response_model=ApiResponse[MeResponse])
def me(user: RequireMember, db: AppDb) -> ApiResponse[MeResponse]:
    """현재 로그인한 사용자 정보. 미인증이면 401, 미가입·탈퇴 회원이면 403."""
    return success_response(get_current_user_summary(user, AuthRepository(db)))


@router.patch("/me", response_model=ApiResponse[MeResponse])
def update_me(body: UpdateNicknameIn, user: RequireMember, db: AppDb) -> ApiResponse[MeResponse]:
    """닉네임 변경. profile 테이블에 저장되어 새로고침해도 유지된다."""
    return success_response(update_nickname(user, body, db), message="닉네임이 변경되었습니다.")


@router.patch("/me/notification-prefs", response_model=ApiResponse[MeResponse])
def update_notification_prefs(
    body: UpdateNotificationPrefIn, user: RequireMember, db: AppDb
) -> ApiResponse[MeResponse]:
    """위험 보고서 생성 완료 알림 수신 여부 변경. profile 테이블에 저장되어 새로고침해도 유지된다"""
    return success_response(
        update_notification_pref(user, body, db), message="알림 설정이 변경되었습니다."
    )


@router.post("/me/avatar", response_model=ApiResponse[MeResponse])
def upload_avatar(
    file: Annotated[UploadFile, File()], user: RequireMember, db: AppDb
) -> ApiResponse[MeResponse]:
    """프로필 사진 업로드. 형식·크기 문제는 여기서 바로 막고, 저장은 서비스가 맡는다."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _AVATAR_SUFFIXES:
        raise AppError("지원하지 않는 파일", "프로필 사진은 PNG, JPG, WEBP 형식이어야 합니다.", 415)

    max_bytes = settings.AVATAR_MAX_FILE_MB * 1024 * 1024
    content = file.file.read(max_bytes + 1)
    if not content:
        raise AppError("빈 파일", "이미지 파일이 비어 있습니다.", 422)
    if len(content) > max_bytes:
        raise AppError(
            "파일 크기 초과",
            f"프로필 사진은 최대 {settings.AVATAR_MAX_FILE_MB}MB까지 업로드할 수 있습니다.",
            413,
        )

    content_type = file.content_type or _AVATAR_CONTENT_TYPES[suffix]
    updated = update_avatar(user, file.filename or f"avatar{suffix}", content, content_type, db)
    return success_response(updated, message="프로필 사진이 변경되었습니다.")


@router.delete("/me", response_model=ApiResponse[WithdrawalResponse])
def withdraw(user: RequireMember, db: AppDb) -> ApiResponse[WithdrawalResponse]:
    """회원 탈퇴(Soft Delete). 대화·계약서 데이터는 지우지 않고 계정만 잠근다."""
    return success_response(withdraw_member(user, db), "회원 탈퇴가 완료되었습니다.")
