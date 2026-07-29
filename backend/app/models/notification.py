"""알림 관련 ORM 모델 = notification."""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Text, false, text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base
from app.models.auth import utcnow

# 가입 축하 알림 문구. 이메일 가입은 DB 트리거(sql/auth_provisioning.sql)가, 카카오 가입은
# services/notification.py 가 같은 문구로 만든다 — 셋 중 하나만 고치면 중복 방지 인덱스가
# 어긋나므로 반드시 함께 바꾼다.
WELCOME_TITLE = "회원가입을 축하합니다."
WELCOME_CONTENT = "AI 분석으로 안전한 계약을 시작해보세요."


class Notification(Base):
    __tablename__ = "notification"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("app_user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    # 가입 축하 알림은 회원당 1건이다. 이메일(트리거)·카카오(가입 API)가 서로 다른 경로로
    # 만들기 때문에 애플리케이션 검사만으로는 동시 실행을 막지 못한다 — DB 제약을 최후
    # 방어선으로 둔다. 조건절이 WELCOME_TITLE 에 묶여 있으니 문구를 바꾸면 인덱스도 바꾼다.
    __table_args__ = (
        Index(
            "uq_notification_welcome",
            "user_id",
            unique=True,
            postgresql_where=text(f"title = '{WELCOME_TITLE}'"),
            sqlite_where=text(f"title = '{WELCOME_TITLE}'"),
        ),
    )
