"""Supabase 카카오 인증 사용자를 앱 회원으로 연결한다."""

import logging
import uuid

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.repositories.auth import AGREEMENT_VERSION, AuthRepository
from app.schemas.kakao_auth import (
    AuthUserInfo,
    KakaoAuthResponse,
    KakaoSignUpRequest,
    PendingKakaoDeletionResponse,
    RegistrationResponse,
)

logger = logging.getLogger(__name__)


def _user_id(claims: dict) -> uuid.UUID:
    try:
        return uuid.UUID(str(claims.get("sub", "")))
    except ValueError as exc:
        raise AppError(
            "로그인 필요",
            "사용자 식별에 실패했습니다. 다시 로그인해 주세요.",
            401,
        ) from exc


def _is_kakao(claims: dict) -> bool:
    metadata = claims.get("app_metadata")
    if not isinstance(metadata, dict):
        return False
    provider = metadata.get("provider")
    providers = metadata.get("providers")
    return provider == "kakao" or (isinstance(providers, list) and "kakao" in providers)


def _is_kakao_only(claims: dict) -> bool:
    metadata = claims.get("app_metadata")
    if not isinstance(metadata, dict) or metadata.get("provider") != "kakao":
        return False
    providers = metadata.get("providers")
    return not isinstance(providers, list) or set(providers) == {"kakao"}


def _metadata(claims: dict) -> dict:
    value = claims.get("user_metadata")
    return value if isinstance(value, dict) else {}


def _clean(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    return cleaned or None


def _nickname(claims: dict, requested: str | None = None) -> str | None:
    metadata = _metadata(claims)
    email = _clean(claims.get("email"))
    candidates = (
        requested,
        metadata.get("nickname"),
        metadata.get("preferred_username"),
        metadata.get("name"),
        email.partition("@")[0] if email else None,
    )
    for candidate in candidates:
        cleaned = _clean(candidate)
        if cleaned:
            return cleaned[:20]
    return None


def _profile_image(claims: dict) -> str | None:
    metadata = _metadata(claims)
    return _clean(metadata.get("avatar_url")) or _clean(metadata.get("picture"))


def _user_info(
    claims: dict,
    repo: AuthRepository,
    *,
    nickname: str | None = None,
) -> AuthUserInfo:
    user_id = _user_id(claims)
    profile = repo.get_profile(user_id)
    return AuthUserInfo(
        id=str(user_id),
        email=_clean(claims.get("email")),
        nickname=nickname or (profile.nickname if profile else _nickname(claims)),
        profile_image=profile.profile_image if profile else _profile_image(claims),
    )


def registration_status(claims: dict, db: Session) -> RegistrationResponse:
    registered = AuthRepository(db).is_registered(_user_id(claims))
    return RegistrationResponse(status="authenticated" if registered else "signup_required")


def process_kakao_login(
    claims: dict,
    db: Session,
    *,
    client_ip: str | None,
    device: str | None,
) -> KakaoAuthResponse:
    if not _is_kakao(claims):
        raise AppError(
            "카카오 인증 오류",
            "카카오로 인증된 세션이 아닙니다. 다시 로그인해 주세요.",
            403,
        )

    user_id = _user_id(claims)
    repo = AuthRepository(db)
    registered = repo.is_registered(user_id)
    if registered:
        try:
            repo.add_login_history(
                user_id,
                client_ip=client_ip,
                device=device,
            )
            db.commit()
        except SQLAlchemyError as exc:
            db.rollback()
            logger.exception("카카오 로그인 이력 저장 실패")
            raise AppError(
                "로그인 처리 실패",
                "로그인 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                500,
            ) from exc

    return KakaoAuthResponse(
        status="authenticated" if registered else "signup_required",
        user=_user_info(claims, repo),
    )


def abandon_pending_kakao_signup(
    claims: dict,
    db: Session,
) -> PendingKakaoDeletionResponse:
    if not _is_kakao(claims):
        raise AppError(
            "카카오 인증 오류",
            "카카오로 인증된 세션이 아닙니다. 다시 로그인해 주세요.",
            403,
        )
    if not _is_kakao_only(claims):
        raise AppError(
            "가입 취소 불가",
            "다른 로그인 방식과 연결된 계정은 자동 삭제할 수 없습니다.",
            409,
        )

    user_id = _user_id(claims)
    repo = AuthRepository(db)
    if repo.is_registered(user_id):
        raise AppError(
            "가입 취소 불가",
            "이미 가입이 완료된 계정은 삭제할 수 없습니다.",
            409,
        )

    try:
        deleted = repo.delete_pending_auth_user(user_id)
        if not deleted and repo.is_registered(user_id):
            raise AppError(
                "가입 취소 불가",
                "이미 가입이 완료된 계정은 삭제할 수 없습니다.",
                409,
            )
        db.commit()
    except AppError:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("미완료 카카오 인증 계정 삭제 실패")
        raise AppError(
            "가입 취소 실패",
            "임시 회원 정보를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            500,
        ) from exc

    return PendingKakaoDeletionResponse(deleted=deleted)


def complete_kakao_signup(
    claims: dict,
    body: KakaoSignUpRequest,
    db: Session,
    *,
    client_ip: str | None,
    device: str | None,
) -> KakaoAuthResponse:
    if not _is_kakao(claims):
        raise AppError(
            "카카오 인증 오류",
            "카카오로 인증된 세션이 아닙니다. 다시 로그인해 주세요.",
            403,
        )

    user_id = _user_id(claims)
    repo = AuthRepository(db)
    if repo.is_registered(user_id):
        raise AppError(
            "이미 가입된 회원",
            "이미 가입이 완료된 계정입니다. 로그인해 주세요.",
            409,
        )

    nickname = _nickname(claims, body.nickname)
    profile_image = _profile_image(claims)
    try:
        repo.add_app_user(user_id)
        repo.upsert_profile(
            user_id,
            nickname=nickname,
            profile_image=profile_image,
        )
        repo.set_agreement(user_id, "terms", AGREEMENT_VERSION, body.agree_terms)
        repo.set_agreement(
            user_id,
            "privacy",
            AGREEMENT_VERSION,
            body.agree_privacy,
        )
        repo.set_agreement(
            user_id,
            "marketing",
            AGREEMENT_VERSION,
            body.agree_marketing,
        )
        repo.add_login_history(
            user_id,
            client_ip=client_ip,
            device=device,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(
            "이미 가입된 회원",
            "이미 가입이 완료된 계정입니다. 로그인해 주세요.",
            409,
        ) from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("카카오 회원가입 DB 저장 실패")
        raise AppError(
            "회원가입 실패",
            "회원 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            500,
        ) from exc

    return KakaoAuthResponse(
        status="authenticated",
        user=AuthUserInfo(
            id=str(user_id),
            email=_clean(claims.get("email")),
            nickname=nickname,
            profile_image=profile_image,
        ),
    )
