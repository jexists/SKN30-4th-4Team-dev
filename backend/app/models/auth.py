"""인증 관련 ORM 모델 = app_user/profile/user_agreement/login_history."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint, false, true
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class AppUser(Base):
    __tablename__ = "app_user"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True)
    username: Mapped[str | None] = mapped_column(Text, unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    # 회원 탈퇴는 Soft Delete 다 — 행을 지우지 않고 이 두 컬럼으로만 표시한다.
    # 조회는 반드시 AuthRepository 를 거쳐 탈퇴 회원을 걸러낸다(직접 db.get 금지).
    # deleted_at 기준 3일이 지난 회원을 완전 삭제하는 배치는 아직 없다 — docs/회원탈퇴.md 참고.
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    profile: Mapped["Profile | None"] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    agreements: Mapped[list["UserAgreement"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    login_history: Mapped[list["LoginHistory"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Profile(Base):
    __tablename__ = "profile"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("app_user.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    nickname: Mapped[str | None] = mapped_column(Text, nullable=True)
    nickname_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    profile_image: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 위험 보고서 생성 완료 알림(마이페이지 "알림 설정" 토글) 수신 여부. 기본은 켜짐이다.
    notify_report_complete: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    user: Mapped[AppUser] = relationship(back_populates="profile")


class UserAgreement(Base):
    __tablename__ = "user_agreement"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "agreement_type",
            "version",
            name="uq_user_agreement_user_type_version",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("app_user.id", ondelete="CASCADE"),
        nullable=False,
    )
    agreement_type: Mapped[str] = mapped_column(String(20))
    version: Mapped[str] = mapped_column(String(30))
    is_agreed: Mapped[bool] = mapped_column(Boolean)
    agreed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[AppUser] = relationship(back_populates="agreements")


class LoginHistory(Base):
    __tablename__ = "login_history"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("app_user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_ip: Mapped[str | None] = mapped_column(
        INET().with_variant(String(45), "sqlite"), nullable=True
    )
    device: Mapped[str | None] = mapped_column(Text, nullable=True)
    login_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[AppUser] = relationship(back_populates="login_history")
