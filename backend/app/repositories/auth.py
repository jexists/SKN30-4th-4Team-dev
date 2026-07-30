"""인증 도메인의 DB 접근을 한곳에 모은 Repository."""

import uuid
from datetime import datetime

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.auth import AppUser, LoginHistory, Profile, UserAgreement, utcnow

AGREEMENT_VERSION = "v1"
REQUIRED_AGREEMENT_TYPES = ("terms", "privacy")


def _is_withdrawn(user: AppUser) -> bool:
    """탈퇴 판정은 두 컬럼 모두를 본다.

    is_deleted 가 도입되기 전 deleted_at 만 찍힌 행이 남아 있을 수 있고, 반대로
    배치가 deleted_at 을 정리하더라도 플래그만으로 계정을 막을 수 있어야 한다.
    """
    return user.is_deleted or user.deleted_at is not None


class AuthRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_app_user(self, user_id: uuid.UUID) -> AppUser | None:
        """탈퇴 회원까지 포함한 원본 행. 조회 API 에는 아래 get_active_app_user 를 쓴다."""
        return self.db.get(AppUser, user_id)

    def get_active_app_user(self, user_id: uuid.UUID) -> AppUser | None:
        """탈퇴하지 않은 회원만. Soft Delete 이므로 행이 남아 있어도 None 이 될 수 있다."""
        user = self.get_app_user(user_id)
        return None if user is None or _is_withdrawn(user) else user

    def is_withdrawn(self, user_id: uuid.UUID) -> bool:
        """탈퇴 처리된 계정인지. '가입한 적 없음'(False)과 구분해야 하는 곳에서 쓴다."""
        user = self.get_app_user(user_id)
        return user is not None and _is_withdrawn(user)

    def soft_delete_user(self, user_id: uuid.UUID) -> datetime:
        """회원 탈퇴 — 행을 지우지 않고 표시만 남기고, 탈퇴 시각을 돌려준다.

        (대화·계약서 등 사용자 데이터는 그대로 둔다. 완전 삭제는 배치의 몫.)
        """
        user = self.db.get(AppUser, user_id)
        if user is None:
            raise LookupError(f"app_user not found: {user_id}")
        deleted_at = utcnow()
        user.is_deleted = True
        user.deleted_at = deleted_at
        user.updated_at = deleted_at
        return deleted_at

    def revoke_refresh_tokens(self, user_id: uuid.UUID) -> None:
        """Supabase 세션·Refresh Token 을 지워 '남은 세션으로 계속 쓰는' 경로를 끊는다.

        액세스 토큰(JWT)은 만료 전까지 서명이 유효하므로 이것만으로는 부족하다.
        그래서 회원 여부 판정(is_registered)이 실제 차단선이고, 여기서는 갱신을 막아
        토큰이 무한히 연장되지 않게 한다.
        """
        is_postgres = self.db.bind is not None and self.db.bind.dialect.name == "postgresql"
        # Supabase 에서 auth.refresh_tokens.user_id 는 varchar 지만 auth.sessions.user_id 는
        # uuid 다 — 후자만 캐스팅이 필요하다(SQLite 폴백에는 uuid 타입이 없다).
        sessions_user_id = "cast(:user_id as uuid)" if is_postgres else ":user_id"

        self.db.execute(
            text("delete from auth.refresh_tokens where user_id = :user_id"),
            {"user_id": str(user_id)},
        )
        self.db.execute(
            text(f"delete from auth.sessions where user_id = {sessions_user_id}"),
            {"user_id": str(user_id)},
        )

    def is_registered(self, user_id: uuid.UUID) -> bool:
        if self.get_active_app_user(user_id) is None:
            return False

        agreed_types = set(
            self.db.execute(
                select(UserAgreement.agreement_type).where(
                    UserAgreement.user_id == user_id,
                    UserAgreement.version == AGREEMENT_VERSION,
                    UserAgreement.agreement_type.in_(REQUIRED_AGREEMENT_TYPES),
                    UserAgreement.is_agreed.is_(True),
                )
            )
            .scalars()
            .all()
        )
        return agreed_types == set(REQUIRED_AGREEMENT_TYPES)

    def add_app_user(self, user_id: uuid.UUID) -> AppUser:
        user = AppUser(id=user_id, username=None)
        self.db.add(user)
        return user

    def delete_pending_auth_user(self, user_id: uuid.UUID) -> bool:
        if self.db.bind is not None and self.db.bind.dialect.name == "postgresql":
            statement = text(
                """
                delete from auth.users as auth_user
                where auth_user.id = cast(:user_id as uuid)
                  and not exists (
                    select 1
                    from public.app_user as app_user
                    where app_user.id = auth_user.id
                      and not app_user.is_deleted
                      and app_user.deleted_at is null
                      and (
                        select count(distinct agreement.agreement_type)
                        from public.user_agreement as agreement
                        where agreement.user_id = auth_user.id
                          and agreement.version = :version
                          and agreement.agreement_type in ('terms', 'privacy')
                          and agreement.is_agreed
                      ) = 2
                  )
                """
            )
        else:
            statement = text("delete from auth.users where id = :user_id")

        result = self.db.execute(
            statement,
            {"user_id": str(user_id), "version": AGREEMENT_VERSION},
        )
        return bool(result.rowcount)

    def get_profile(self, user_id: uuid.UUID) -> Profile | None:
        return self.db.execute(
            select(Profile).where(Profile.user_id == user_id)
        ).scalar_one_or_none()

    def upsert_profile(
        self,
        user_id: uuid.UUID,
        *,
        nickname: str | None,
        profile_image: str | None,
        notify_report_complete: bool = True,
    ) -> Profile:
        profile = self.get_profile(user_id)
        if profile is None:
            profile = Profile(
                user_id=user_id,
                nickname=nickname,
                profile_image=profile_image,
                notify_report_complete=notify_report_complete,
            )
            self.db.add(profile)
            return profile

        if profile.nickname != nickname:
            profile.nickname = nickname
            profile.nickname_updated_at = utcnow()
        profile.profile_image = profile_image
        profile.notify_report_complete = notify_report_complete
        profile.updated_at = utcnow()
        return profile

    def set_agreement(
        self,
        user_id: uuid.UUID,
        agreement_type: str,
        version: str,
        is_agreed: bool,
    ) -> UserAgreement:
        row = self.db.execute(
            select(UserAgreement).where(
                UserAgreement.user_id == user_id,
                UserAgreement.agreement_type == agreement_type,
                UserAgreement.version == version,
            )
        ).scalar_one_or_none()
        if row is None:
            row = UserAgreement(
                user_id=user_id,
                agreement_type=agreement_type,
                version=version,
                is_agreed=is_agreed,
            )
            self.db.add(row)
            return row

        row.is_agreed = is_agreed
        row.agreed_at = utcnow()
        return row

    def add_login_history(
        self,
        user_id: uuid.UUID,
        *,
        client_ip: str | None,
        device: str | None,
    ) -> LoginHistory:
        row = LoginHistory(user_id=user_id, client_ip=client_ip, device=device)
        self.db.add(row)
        return row
