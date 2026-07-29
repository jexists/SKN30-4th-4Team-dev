"""인증된 사용자 클레임을 애플리케이션 사용자 정보로 변환한다."""

import logging
import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.repositories.auth import AuthRepository
from app.schemas.auth import MeResponse, WithdrawalResponse

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


def get_current_user_summary(user: dict) -> MeResponse:
    """Supabase JWT에서 회원가입 시 저장한 닉네임을 포함한 사용자 정보를 만든다.

    회원가입 화면은 nickname을 ``user_metadata``에 저장한다. 닉네임을 입력하지 않은
    기존 사용자에게는 DB provisioning 트리거와 같은 규칙으로 이메일 앞부분을 사용한다.
    """
    email = user.get("email")
    metadata = user.get("user_metadata")
    raw_nickname = metadata.get("nickname") if isinstance(metadata, dict) else None
    nickname = raw_nickname.strip() if isinstance(raw_nickname, str) else None

    if not nickname and isinstance(email, str):
        nickname = email.partition("@")[0].strip() or None

    return MeResponse(
        id=str(user.get("sub", "")),
        email=email,
        role=user.get("role"),
        nickname=nickname,
    )


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
