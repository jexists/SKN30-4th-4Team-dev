"""인증 도메인의 DB 접근을 한곳에 모은 Repository."""

import uuid

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.auth import AppUser, LoginHistory, Profile, UserAgreement, utcnow

AGREEMENT_VERSION = "v1"
REQUIRED_AGREEMENT_TYPES = ("terms", "privacy")


class AuthRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_app_user(self, user_id: uuid.UUID) -> AppUser | None:
        return self.db.get(AppUser, user_id)

    def is_registered(self, user_id: uuid.UUID) -> bool:
        user = self.get_app_user(user_id)
        if user is None or user.deleted_at is not None:
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
    ) -> Profile:
        profile = self.get_profile(user_id)
        if profile is None:
            profile = Profile(
                user_id=user_id,
                nickname=nickname,
                profile_image=profile_image,
            )
            self.db.add(profile)
            return profile

        if profile.nickname != nickname:
            profile.nickname = nickname
            profile.nickname_updated_at = utcnow()
        profile.profile_image = profile_image
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
