"""채팅 기록 ORM 모델 = chat_room / chat_message (sql/schema.sql 5·6번).

프론트가 Supabase 로 직접 쓰던 것을 백엔드가 이관받는다. 실데이터는 Supabase Postgres 에 있고,
백엔드 연결 role 은 RLS 를 우회하므로 소유권(user_id==sub) 검증은 라우트 코드가 담당한다.

포터블 원칙:
- id 는 파이썬 측(uuid4)에서 생성 → gen_random_uuid() 미의존.
- 시각도 파이썬 측(datetime.now(UTC))에서 생성한다. server_default(func.now())를 쓰면 SQLite 는
  '초' 단위라 커서(keyset) 정렬이 같은 초 안에서 무너진다 → 마이크로초 단위 파이썬 기본값으로 통일해
  삽입 순서대로 단조 증가하게 한다(운영 Postgres·테스트 SQLite 공통). 실 테이블 DEFAULT 는 그대로.
- user_id 는 app_user FK 를 ORM 에 넣지 않는다(그 테이블을 모델링하지 않아 SQLite create_all 이
  깨지므로) — 무결성은 실제 DB 제약이 지킨다. 시각 컬럼은 timestamptz 에 맞춰 timezone=True.
"""

import threading
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import JSON, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import Uuid

from app.db.base import Base

# SQLite 폴백(테스트)에서도 같은 컬럼을 쓰기 위한 변형. analysis_job.py 와 같은 방식이다.
JsonB = JSONB().with_variant(JSON(), "sqlite")

_clock_lock = threading.Lock()
_last_ts: datetime | None = None


def monotonic_utcnow() -> datetime:
    """마이크로초 단위로 '엄격히 증가'하는 UTC 시각.

    같은 마이크로초에 여러 행이 생겨도 created_at/updated_at 이 겹치지 않게 해, 커서(keyset)
    정렬이 삽입 순서를 그대로 유지하도록 한다(저해상도 시계인 Windows 등에서도 안정적).
    같은 마이크로초면 직전 값 +1µs 로 밀어 올린다."""
    global _last_ts
    with _clock_lock:
        now = datetime.now(UTC)
        if _last_ts is not None and now <= _last_ts:
            now = _last_ts + timedelta(microseconds=1)
        _last_ts = now
        return now


class ChatRoom(Base):
    __tablename__ = "chat_room"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False, index=True)
    title: Mapped[str | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=monotonic_utcnow)
    # 마지막으로 채팅한 시각 = 목록 정렬·표시 기준.
    # 아직 대화가 없으면 방을 만든 시각이 그대로 남는다.
    last_chat_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=monotonic_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=monotonic_utcnow)
    title_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 이 방에 첨부된 계약서 분석(analysis_job.id). 붙어 있으면 이후 모든 질문에 계약서 맥락이
    # 함께 들어간다. user_id 와 같은 이유로 ORM 쪽 FK 는 걸지 않는다 — 무결성은 실제 DB 제약이
    # 지키고, 분석이 삭제돼도 대화는 남도록 스키마에서 ON DELETE SET NULL 이다.
    analysis_job_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True), nullable=True, index=True
    )

    messages: Mapped[list["ChatMessage"]] = relationship(
        back_populates="room", cascade="all, delete-orphan"
    )


class ChatMessage(Base):
    __tablename__ = "chat_message"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    chat_room_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("chat_room.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column()  # USER / ASSISTANT / SYSTEM
    content: Mapped[str] = mapped_column()
    # 이 메시지와 함께 보낸 첨부파일 — [{"name": ..., "kind": "image"|"pdf"|"file"}].
    # **파일명과 종류만** 담는다. 원본 바이트는 워커가 분석을 끝내며 지우므로 서버에 없다.
    # "지금 이 대화가 무슨 계약서를 읽는가" 는 chat_room.analysis_job_id 가 들고, 이 컬럼은
    # "어느 메시지에 무엇을 붙여 보냈는가" 라는 대화 기록만 담당한다(둘은 어긋날 수 있다 —
    # 새 계약서를 첨부하면 방은 최신 것만 참고하지만 옛 메시지의 첨부 표시는 그대로 남는다).
    attachments: Mapped[list[dict[str, str]] | None] = mapped_column(JsonB, nullable=True)
    response_time: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=monotonic_utcnow)

    room: Mapped[ChatRoom] = relationship(back_populates="messages")
