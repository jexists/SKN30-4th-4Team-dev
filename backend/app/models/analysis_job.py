"""AI 분석 작업·산출물 ORM 모델 = analysis_job/analysis_result.

analysis_job 은 그 자체가 **작업 큐**다. Redis 를 두지 않고 워커가 QUEUED 행을
`FOR UPDATE SKIP LOCKED` 로 하나씩 선점한다(locked_by/lease_expires_at). uvicorn worker 를
여러 개로 늘려도 같은 작업이 두 번 실행되지 않는다.

업로드 원본은 공유 저장소에 보관한다. 그래서 기동 시 QUEUED 와 lease 가 살아 있는 RUNNING 은
그대로 두고, lease 만료 작업은 남은 시도 횟수에 따라 재큐잉하거나 FAILED 로 정리할 수 있다.
"""

import uuid
from collections.abc import Iterable
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    SmallInteger,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import Uuid

from app.db.base import Base
from app.models.auth import utcnow

# SQLite 폴백(테스트)에서도 같은 컬럼을 쓰기 위한 변형. auth.py 의 INET 처리와 같은 방식이다.
JsonB = JSONB().with_variant(JSON(), "sqlite")


class JobStatus(StrEnum):
    """작업 상태 머신. sql/schema.sql 의 CHECK 제약과 반드시 같아야 한다.

    QUEUED → RUNNING → SUCCEEDED
                     ↘ FAILED
                     ↘ CANCELLED
    """

    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


#: 더 이상 변하지 않는 상태 — 프론트는 여기 도달하면 폴링을 멈춘다.
TERMINAL_STATUSES = frozenset({JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED})
#: 아직 끝나지 않은 상태 — 회원당 1건만 존재할 수 있다(uq_analysis_job_active).
ACTIVE_STATUSES = frozenset({JobStatus.QUEUED, JobStatus.RUNNING})


class JobStage(StrEnum):
    """진행 화면에 "무엇을 하고 있는지" 보여주기 위한 단계. status 와 달리 참고용이다."""

    UPLOADING = "UPLOADING"
    OCR = "OCR"
    ANALYZING = "ANALYZING"
    RAG = "RAG"
    LLM = "LLM"
    SAVING = "SAVING"
    COMPLETED = "COMPLETED"


class RiskLevel(StrEnum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


def _in_list(column: str, values: Iterable[StrEnum]) -> str:
    """CHECK 제약·부분 인덱스의 IN 절을 enum 에서 만든다 — 값을 두 곳에 손으로 적지 않으려는 것."""
    joined = ", ".join(f"'{member.value}'" for member in values)
    return f"{column} IN ({joined})"


# frozenset 은 순서가 없으므로 정렬해 DDL 이 실행마다 같은 문자열이 되게 한다.
_ACTIVE_PREDICATE = text(_in_list("status", sorted(ACTIVE_STATUSES)))
_QUEUED_PREDICATE = text(f"status = '{JobStatus.QUEUED.value}'")
_RUNNING_PREDICATE = text(f"status = '{JobStatus.RUNNING.value}'")
_HAS_IDEMPOTENCY_KEY = text("idempotency_key IS NOT NULL")
#: 사용자가 지우지 않은 작업. 목록 인덱스에만 건다 — 큐·중복 방지 인덱스는 아래 주석 참고.
_ALIVE_PREDICATE = text("deleted_at IS NULL")


class AnalysisJob(Base):
    __tablename__ = "analysis_job"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("app_user.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 같은 요청의 재전송(더블클릭·네트워크 재시도)을 같은 작업으로 흡수한다.
    idempotency_key: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(Text, nullable=False, default=JobStatus.QUEUED.value)
    stage: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    attempt_count: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)

    file_names: Mapped[list[str]] = mapped_column(JsonB, nullable=False, default=list)

    # error_message 는 그대로 사용자에게 보인다. 내부 예외 문자열·API 키·경로·계약서
    # 개인정보를 넣지 않는다 — 원인은 error_code 와 logger.exception 에 남긴다.
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    locked_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    queued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    # 사용자가 목록에서 지운 작업. 행은 남긴다(soft delete) — 조회 경로가 걸러낸다.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        CheckConstraint(_in_list("status", JobStatus), name="analysis_job_status_check"),
        CheckConstraint(
            f"stage IS NULL OR {_in_list('stage', JobStage)}", name="analysis_job_stage_check"
        ),
        CheckConstraint("progress BETWEEN 0 AND 100", name="analysis_job_progress_check"),
        # 목록은 살아 있는 행만 본다 — 지운 작업을 훑지 않게 인덱스에 조건을 넣는다.
        Index(
            "idx_analysis_job_user_alive",
            "user_id",
            "created_at",
            postgresql_where=_ALIVE_PREDICATE,
            sqlite_where=_ALIVE_PREDICATE,
        ),
        # ⚠️ 아래 큐·중복 방지 인덱스에는 deleted_at 조건을 넣지 않는다. 지워진 작업이라도
        #    진행 중이면 워커가 정상적으로 끝맺어야 하고, 진행 중 1건 제약도 그대로여야 한다.
        # 워커가 다음 작업을 고를 때 훑는 인덱스 — 대기 중인 행만 담는다.
        Index(
            "idx_analysis_job_queue",
            "queued_at",
            postgresql_where=_QUEUED_PREDICATE,
            sqlite_where=_QUEUED_PREDICATE,
        ),
        # lease 가 만료된 좀비 작업을 회수할 때 훑는 인덱스.
        Index(
            "idx_analysis_job_lease",
            "lease_expires_at",
            postgresql_where=_RUNNING_PREDICATE,
            sqlite_where=_RUNNING_PREDICATE,
        ),
        # 회원당 진행 중 작업은 1건. 애플리케이션도 먼저 검사하지만(409), 동시에 들어온
        # 두 요청은 DB 만이 막을 수 있다.
        Index(
            "uq_analysis_job_active",
            "user_id",
            unique=True,
            postgresql_where=_ACTIVE_PREDICATE,
            sqlite_where=_ACTIVE_PREDICATE,
        ),
        # 같은 idempotency key 의 재전송은 새 작업을 만들지 않는다.
        Index(
            "uq_analysis_job_idempotency",
            "user_id",
            "idempotency_key",
            unique=True,
            postgresql_where=_HAS_IDEMPOTENCY_KEY,
            sqlite_where=_HAS_IDEMPOTENCY_KEY,
        ),
    )


class AnalysisResult(Base):
    """분석 산출물. analysis_job 과 1:1.

    작업(진행 상태)과 산출물을 분리한 이유: 실패한 분석을 다시 돌리면 작업은 새로 생기지만
    과거 산출물은 그대로 남고, 목록 화면은 payload(수십 KB)를 읽지 않고 title·risk_level 만
    조인해 쓸 수 있다.
    """

    __tablename__ = "analysis_result"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("analysis_job.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    # 조회 때마다 job 을 조인하지 않고 소유권을 검사하려고 함께 둔다.
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("app_user.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    risk_level: Mapped[str | None] = mapped_column(Text, nullable=True)
    # AnalysisResultOut 전문. 마스킹 PDF 는 용량 때문에 넣지 않는다.
    payload: Mapped[dict[str, Any]] = mapped_column(JsonB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # 사용자가 목록에서 제목을 고칠 수 있어 "언제 고쳤는지" 가 필요하다.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    __table_args__ = (
        CheckConstraint(
            f"risk_level IS NULL OR {_in_list('risk_level', RiskLevel)}",
            name="analysis_result_risk_level_check",
        ),
        Index("idx_analysis_result_user", "user_id", "created_at"),
    )


class AnalysisExternalJob(Base):
    """분석 파일 하나와 RunPod Serverless 작업 하나의 영속 매핑."""

    __tablename__ = "analysis_external_job"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    analysis_job_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("analysis_job.id", ondelete="CASCADE"),
        nullable=False,
    )
    file_index: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    external_job_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    external_status: Mapped[str] = mapped_column(Text, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    __table_args__ = (
        CheckConstraint("file_index >= 0", name="analysis_external_job_file_index_check"),
        UniqueConstraint("analysis_job_id", "file_index", name="uq_analysis_external_job_file"),
        Index("idx_analysis_external_job_analysis", "analysis_job_id", "file_index"),
    )
