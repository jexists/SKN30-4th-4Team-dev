"""알림 관련 ORM 모델 = notification."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base
from app.models.auth import utcnow


class NotificationType(StrEnum):
    """알림 종류. sql/schema.sql 의 CHECK 제약과 반드시 같아야 한다."""

    GENERAL = "GENERAL"
    WELCOME = "WELCOME"
    ANALYSIS_STARTED = "ANALYSIS_STARTED"
    ANALYSIS_COMPLETED = "ANALYSIS_COMPLETED"
    ANALYSIS_FAILED = "ANALYSIS_FAILED"


class ResourceType(StrEnum):
    """알림을 클릭했을 때 이동할 대상의 종류.

    완성된 URL 대신 종류+id 만 저장한다 — 라우트가 바뀌면 DB 에 남은 과거 알림이 통째로
    깨지기 때문이다. 경로는 프론트(`notificationLink.ts`)가 만든다.
    """

    ANALYSIS_JOB = "ANALYSIS_JOB"


# 가입 축하 알림. 이메일 가입은 DB 트리거(sql/auth_provisioning.sql)가, 카카오 가입은
# services/notification.py 가 같은 값으로 만든다. 중복을 막는 건 dedupe_key 이므로
# 문구를 바꾸는 건 안전하지만 WELCOME_DEDUPE_KEY 를 바꾸면 방어가 풀린다.
WELCOME_TITLE = "회원가입을 축하합니다."
WELCOME_CONTENT = "AI 분석으로 안전한 계약을 시작해보세요."
WELCOME_DEDUPE_KEY = "welcome"


def analysis_dedupe_key(job_id: uuid.UUID, status: str) -> str:
    """분석 알림의 중복 방지 키. 같은 작업의 같은 결말은 한 번만 알린다."""
    return f"analysis:{job_id}:{status}"


_HAS_DEDUPE_KEY = text("dedupe_key IS NOT NULL")
_ALIVE = text("deleted_at IS NULL")
_ALIVE_UNREAD = text("deleted_at IS NULL AND read_at IS NULL")
_TYPE_VALUES = ", ".join(f"'{member.value}'" for member in NotificationType)
_RESOURCE_TYPE_VALUES = ", ".join(f"'{member.value}'" for member in ResourceType)


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("app_user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[str] = mapped_column(Text, nullable=False, default=NotificationType.GENERAL.value)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    resource_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)

    # 같은 사건에 대한 알림을 두 번 만들지 않기 위한 키. 발신 측이 정한다.
    dedupe_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    # 읽음/삭제를 불리언이 아니라 nullable timestamp 로 표현한다. `read_at IS NOT NULL` 이
    # 곧 "읽음" 이라 불리언을 완전히 대체하면서 시각까지 남는다. is_read/is_deleted 같은
    # 짝 컬럼을 따로 두면 같은 사실을 두 곳이 표현해 불일치가 생기므로 만들지 않는다.
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        CheckConstraint(f"type IN ({_TYPE_VALUES})", name="notification_type_check"),
        CheckConstraint(
            f"resource_type IS NULL OR resource_type IN ({_RESOURCE_TYPE_VALUES})",
            name="notification_resource_type_check",
        ),
        # 전체 탭: 최신순 커서 페이지네이션. created_at 만으로는 DB 트리거와 앱이 같은 시각에
        # 만든 행이 페이지 경계에서 유실·중복되므로 id 를 타이브레이커로 함께 넣는다.
        Index(
            "idx_notification_user_created",
            "user_id",
            "created_at",
            "id",
            postgresql_where=_ALIVE,
            sqlite_where=_ALIVE,
        ),
        # "읽지 않음" 탭 + 헤더 Badge 개수 전용. 안읽음만 담아 인덱스가 작게 유지된다.
        Index(
            "idx_notification_user_unread",
            "user_id",
            "created_at",
            "id",
            postgresql_where=_ALIVE_UNREAD,
            sqlite_where=_ALIVE_UNREAD,
        ),
        # 같은 사건에 대한 알림은 회원당 1건. 가입 축하는 이메일(트리거)과 카카오(가입 완료
        # API)가 서로 다른 경로로 만들기 때문에 애플리케이션 검사만으로는 동시 실행을 막지
        # 못한다 — 최후 방어선을 DB 에 둔다. 분석 완료/실패 알림의 중복도 같은 인덱스가 막는다.
        # deleted_at 조건을 일부러 넣지 않는다: 넣으면 알림을 지운 뒤 중복 생성이 가능해진다.
        Index(
            "uq_notification_dedupe",
            "user_id",
            "dedupe_key",
            unique=True,
            postgresql_where=_HAS_DEDUPE_KEY,
            sqlite_where=_HAS_DEDUPE_KEY,
        ),
    )
