"""인증된 사용자 클레임을 애플리케이션 사용자 정보로 변환한다."""

import logging
import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.repositories.auth import AuthRepository
from app.schemas.auth import (
    MeResponse,
    UpdateNicknameIn,
    UpdateNotificationPrefIn,
    WithdrawalResponse,
)
from app.services import storage

logger = logging.getLogger(__name__)


def claims_user_id(claims: dict) -> uuid.UUID:
    """JWT 의 sub 를 앱 사용자 ID 로 해석한다. 형식이 틀리면 401."""
    try:
        return uuid.UUID(str(claims.get("sub", "")))
    except ValueError as exc:
        raise AppError(
            "로그인 필요",
            "사용자 식별에 실패했습니다. 다시 로그인해 주세요.",
            401,
        ) from exc


def reject_if_withdrawn(repo: AuthRepository, user_id: uuid.UUID) -> None:
    """탈퇴한 계정이면 403 으로 막는다.

    Soft Delete 라 Supabase 의 auth.users 행은 그대로 남는다. 즉 카카오 로그인 자체는
    다시 성공하므로, '가입한 적 없음'(가입 화면으로 안내)과 '탈퇴함'(차단)을 여기서
    갈라주지 않으면 탈퇴 회원이 가입 화면을 맴돌게 된다.
    """
    if repo.is_withdrawn(user_id):
        raise AppError(
            "탈퇴한 계정",
            "탈퇴 처리된 계정입니다. 다시 이용하시려면 새로 가입해 주세요.",
            403,
        )


def _login_provider(user: dict) -> str | None:
    """Supabase 세션의 로그인 수단("email"/"kakao"). auth.identities.provider 와 같다."""
    metadata = user.get("app_metadata")
    provider = metadata.get("provider") if isinstance(metadata, dict) else None
    return provider if isinstance(provider, str) else None


def get_current_user_summary(user: dict, repo: AuthRepository) -> MeResponse:
    """프로필(DB) 에 저장된 닉네임을 우선하고, 없으면 Supabase JWT 값으로 대신한다.

    마이페이지에서 닉네임을 바꾸면 profile.nickname 에 저장된다(update_nickname 참고) —
    그래서 여기서도 DB 를 먼저 본다. 아직 한 번도 바꾼 적 없는 사용자는 회원가입 화면이
    ``user_metadata`` 에 저장한 닉네임을, 그것도 없으면 이메일 앞부분을 쓴다.
    """
    email = user.get("email")
    user_id = claims_user_id(user)
    profile = repo.get_profile(user_id)
    nickname = profile.nickname.strip() if profile and profile.nickname else None

    if not nickname:
        metadata = user.get("user_metadata")
        raw_nickname = metadata.get("nickname") if isinstance(metadata, dict) else None
        nickname = raw_nickname.strip() if isinstance(raw_nickname, str) else None

    if not nickname and isinstance(email, str):
        nickname = email.partition("@")[0].strip() or None

    return MeResponse(
        id=str(user_id),
        email=email,
        role=user.get("role"),
        nickname=nickname,
        login_provider=_login_provider(user),
        profile_image=profile.profile_image if profile else None,
        notify_report_complete=profile.notify_report_complete if profile else True,
    )


def update_nickname(claims: dict, body: UpdateNicknameIn, db: Session) -> MeResponse:
    """닉네임을 profile 테이블에 저장한다. 프로필 이미지·알림 설정은 건드리지 않고 그대로 둔다."""
    user_id = claims_user_id(claims)
    repo = AuthRepository(db)
    if not repo.is_registered(user_id):
        raise AppError("회원 정보 없음", "가입이 완료되지 않은 계정입니다.", 403)

    existing = repo.get_profile(user_id)
    profile_image = existing.profile_image if existing else None
    notify_report_complete = existing.notify_report_complete if existing else True
    try:
        repo.upsert_profile(
            user_id,
            nickname=body.nickname,
            profile_image=profile_image,
            notify_report_complete=notify_report_complete,
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("닉네임 변경 실패")
        raise AppError(
            "닉네임 변경 실패",
            "닉네임을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            500,
        ) from exc

    return get_current_user_summary(claims, repo)


def update_avatar(
    claims: dict, filename: str, content: bytes, content_type: str, db: Session
) -> MeResponse:
    """프로필 사진을 Supabase Storage 에 올리고 URL 을 profile 테이블에 저장한다.

    닉네임 변경(update_nickname)과 대칭이다 — 그쪽은 nickname 만 바꾸며 기존
    profile_image 를 그대로 넘기고, 여기서는 profile_image 만 바꾸며 기존 nickname 을
    그대로 넘긴다. upsert_profile 이 필드를 함께 덮어쓰기 때문에 건드리지 않는 쪽도
    항상 다시 넣어줘야 한다.
    """
    user_id = claims_user_id(claims)
    repo = AuthRepository(db)
    if not repo.is_registered(user_id):
        raise AppError("회원 정보 없음", "가입이 완료되지 않은 계정입니다.", 403)

    image_url = storage.upload_avatar(user_id, filename, content, content_type)

    existing = repo.get_profile(user_id)
    nickname = existing.nickname if existing else None
    notify_report_complete = existing.notify_report_complete if existing else True
    try:
        repo.upsert_profile(
            user_id,
            nickname=nickname,
            profile_image=image_url,
            notify_report_complete=notify_report_complete,
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("프로필 사진 저장 실패")
        raise AppError(
            "프로필 사진 저장 실패",
            "프로필 사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            500,
        ) from exc

    return get_current_user_summary(claims, repo)


def update_notification_pref(
    claims: dict, body: UpdateNotificationPrefIn, db: Session
) -> MeResponse:
    """위험 보고서 생성 완료 알림 수신 여부를 profile 테이블에 저장한다.

    닉네임·프로필 사진과 대칭이다 — 건드리지 않는 필드는 기존 값을 그대로 다시 넣는다.
    """
    user_id = claims_user_id(claims)
    repo = AuthRepository(db)
    if not repo.is_registered(user_id):
        raise AppError("회원 정보 없음", "가입이 완료되지 않은 계정입니다.", 403)

    existing = repo.get_profile(user_id)
    nickname = existing.nickname if existing else None
    profile_image = existing.profile_image if existing else None
    try:
        repo.upsert_profile(
            user_id,
            nickname=nickname,
            profile_image=profile_image,
            notify_report_complete=body.notify_report_complete,
        )
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("알림 설정 저장 실패")
        raise AppError(
            "알림 설정 저장 실패",
            "알림 설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            500,
        ) from exc

    return get_current_user_summary(claims, repo)


def withdraw_member(claims: dict, db: Session) -> WithdrawalResponse:
    """회원 탈퇴 — Soft Delete 로 표시하고 Refresh Token 을 폐기한다.

    행을 지우지 않는 이유: 대화·계약서 등 사용자 데이터가 그대로 남아 있어 계정만
    먼저 지우면 주인 없는 데이터가 된다. 지금은 유지하고, deleted_at 기준 3일이 지난
    회원의 데이터와 계정을 함께 지우는 배치를 나중에 붙인다(docs/회원탈퇴.md).
    """
    user_id = claims_user_id(claims)
    repo = AuthRepository(db)

    # 라우트의 RequireMember 가 이미 걸러내지만, 서비스 자체로도 성립해야 하는 전제다.
    if not repo.is_registered(user_id):
        raise AppError(
            "회원 탈퇴 불가",
            "이미 탈퇴했거나 가입이 완료되지 않은 계정입니다.",
            409,
        )

    try:
        deleted_at = repo.soft_delete_user(user_id)
        repo.revoke_refresh_tokens(user_id)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("회원 탈퇴 처리 실패")
        raise AppError(
            "회원 탈퇴 실패",
            "탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.",
            500,
        ) from exc

    return WithdrawalResponse(id=str(user_id), deleted_at=deleted_at)
