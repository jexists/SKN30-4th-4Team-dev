"""analysis_job / analysis_result 테이블 접근.

이 리포지토리가 작업 큐의 전부다 — 워커는 claim_next 로 한 건을 선점하고, 끝나면
mark_succeeded / mark_failed 로 닫는다.
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import Select, select, update
from sqlalchemy.orm import Session

from app.models.analysis_job import (
    ACTIVE_STATUSES,
    AnalysisJob,
    AnalysisResult,
    JobStatus,
)
from app.models.auth import utcnow

_ACTIVE = [s.value for s in sorted(ACTIVE_STATUSES)]


class AnalysisJobRepository:
    def __init__(self, db: Session):
        self.db = db

    # ── 생성·조회 ────────────────────────────────────────────────────

    def create(
        self,
        user_id: uuid.UUID,
        *,
        file_names: Sequence[str],
        idempotency_key: str | None = None,
        job_id: uuid.UUID | None = None,
    ) -> AnalysisJob:
        job = AnalysisJob(
            id=job_id or uuid.uuid4(),
            user_id=user_id,
            file_names=list(file_names),
            idempotency_key=idempotency_key,
            status=JobStatus.QUEUED.value,
        )
        self.db.add(job)
        return job

    def find_active(self, user_id: uuid.UUID) -> AnalysisJob | None:
        """진행 중인 작업. 있으면 새 요청을 409 로 막는다.

        **여기엔 deleted_at 필터를 걸지 않는다** — 워커 경로(claim_next·lease 복구)와 DB 의
        uq_analysis_job_active 도 삭제 여부를 모르기 때문이다. 필터를 걸면 "숨겨졌지만 아직
        도는 작업" 때문에 새 분석이 영영 409 로 막힌다(그래서 라우터가 진행 중 삭제를 거절한다).
        """
        return self.db.execute(
            select(AnalysisJob)
            .where(AnalysisJob.user_id == user_id, AnalysisJob.status.in_(_ACTIVE))
            .limit(1)
        ).scalar_one_or_none()

    def find_by_idempotency_key(self, user_id: uuid.UUID, key: str) -> AnalysisJob | None:
        return self.db.execute(
            select(AnalysisJob)
            .where(AnalysisJob.user_id == user_id, AnalysisJob.idempotency_key == key)
            .limit(1)
        ).scalar_one_or_none()

    def get_owned(self, job_id: uuid.UUID, user_id: uuid.UUID) -> AnalysisJob | None:
        """내 작업만, 그리고 지우지 않은 것만.

        남의 작업도 지운 작업도 None → 라우터가 404 로 만든다(존재 여부 비노출).
        **사용자 조회 경로의 soft delete 필터는 여기와 `_owned` 두 곳이 전부다** — 목록·상세·
        제목 수정·삭제가 모두 이 둘을 거치므로 규칙이 갈라지지 않는다.
        """
        return self.db.execute(
            select(AnalysisJob).where(
                AnalysisJob.id == job_id,
                AnalysisJob.user_id == user_id,
                AnalysisJob.deleted_at.is_(None),
            )
        ).scalar_one_or_none()

    def get_result(self, job_id: uuid.UUID) -> AnalysisResult | None:
        return self.db.execute(
            select(AnalysisResult).where(AnalysisResult.job_id == job_id)
        ).scalar_one_or_none()

    def _owned(self, user_id: uuid.UUID) -> Select:
        return (
            select(AnalysisJob, AnalysisResult)
            .outerjoin(AnalysisResult, AnalysisResult.job_id == AnalysisJob.id)
            .where(AnalysisJob.user_id == user_id, AnalysisJob.deleted_at.is_(None))
        )

    def list_by_user(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[datetime, uuid.UUID] | None = None,
    ) -> tuple[list[tuple[AnalysisJob, AnalysisResult | None]], bool]:
        """최신순 한 페이지. payload 를 읽지 않도록 요약 컬럼만 조인해 온다."""
        stmt = self._owned(user_id).order_by(AnalysisJob.created_at.desc(), AnalysisJob.id.desc())
        if cursor is not None:
            c_ts, c_id = cursor
            stmt = stmt.where(
                (AnalysisJob.created_at < c_ts)
                | ((AnalysisJob.created_at == c_ts) & (AnalysisJob.id < c_id))
            )
        rows = list(self.db.execute(stmt.limit(limit + 1)).all())
        has_more = len(rows) > limit
        return [(row[0], row[1]) for row in rows[:limit]], has_more

    # ── 워커 ────────────────────────────────────────────────────────

    def claim_next(self, worker_id: str, *, lease_seconds: int) -> AnalysisJob | None:
        """QUEUED 한 건을 선점해 RUNNING 으로 바꾼다. 없으면 None.

        Postgres 에서는 `FOR UPDATE SKIP LOCKED` 로 다른 워커가 보고 있는 행을 건너뛴다.
        그와 별개로 UPDATE 에 `status = 'QUEUED'` 조건을 다시 거는 이유: 행 잠금을 지원하지
        않는 SQLite(테스트)에서도, 그리고 잠금 사이 경합에서도 **딱 한 워커만 이기게** 하려는
        것이다(rowcount == 0 이면 진 것).
        """
        stmt = (
            select(AnalysisJob)
            .where(AnalysisJob.status == JobStatus.QUEUED.value)
            .order_by(AnalysisJob.queued_at)
            .limit(1)
        )
        if self.db.bind is not None and self.db.bind.dialect.name == "postgresql":
            stmt = stmt.with_for_update(skip_locked=True)

        job = self.db.execute(stmt).scalar_one_or_none()
        if job is None:
            return None

        now = utcnow()
        won = self.db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.id == job.id, AnalysisJob.status == JobStatus.QUEUED.value)
            .values(
                status=JobStatus.RUNNING.value,
                locked_by=worker_id,
                started_at=now,
                heartbeat_at=now,
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                attempt_count=AnalysisJob.attempt_count + 1,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        if not won.rowcount:
            self.db.rollback()
            return None
        self.db.commit()
        self.db.refresh(job)
        return job

    def heartbeat(self, job_id: uuid.UUID, *, lease_seconds: int) -> None:
        """살아 있다고 알리고 lease 를 연장한다. 오래 걸리는 단계 사이사이에 부른다."""
        now = utcnow()
        self.db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.id == job_id)
            .values(
                heartbeat_at=now,
                lease_expires_at=now + timedelta(seconds=lease_seconds),
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        self.db.commit()

    def set_attempt(self, job_id: uuid.UUID, attempt: int) -> None:
        """재시도할 때마다 올린다. claim_next 가 1로 시작하므로 총 시도 횟수가 된다."""
        self.db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.id == job_id)
            .values(attempt_count=attempt, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        )
        self.db.commit()

    def set_stage(self, job_id: uuid.UUID, stage: str, progress: int) -> None:
        self.db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.id == job_id)
            .values(stage=stage, progress=progress, updated_at=utcnow())
            .execution_options(synchronize_session=False)
        )
        self.db.commit()

    def mark_succeeded(
        self,
        job_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        payload: dict[str, Any],
        title: str | None,
        summary: str | None,
        risk_level: str | None,
    ) -> None:
        """산출물 저장과 상태 전환을 같은 커밋에 묶는다.

        SUCCEEDED 인데 결과가 없는 상태를 만들지 않으려는 것이다.
        """
        now = utcnow()
        self.db.add(
            AnalysisResult(
                job_id=job_id,
                user_id=user_id,
                title=title,
                summary=summary,
                risk_level=risk_level,
                payload=payload,
            )
        )
        self.db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.id == job_id)
            .values(
                status=JobStatus.SUCCEEDED.value,
                stage="COMPLETED",
                progress=100,
                finished_at=now,
                updated_at=now,
                error_code=None,
                error_message=None,
                lease_expires_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        self.db.commit()

    def mark_failed(self, job_id: uuid.UUID, *, code: str, message: str) -> None:
        now = utcnow()
        self.db.execute(
            update(AnalysisJob)
            .where(AnalysisJob.id == job_id)
            .values(
                status=JobStatus.FAILED.value,
                error_code=code,
                error_message=message,
                finished_at=now,
                updated_at=now,
                lease_expires_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        self.db.commit()

    # ── 복구 ────────────────────────────────────────────────────────

    def fail_active(self, *, code: str, message: str) -> list[tuple[uuid.UUID, uuid.UUID]]:
        """남아 있는 QUEUED/RUNNING 을 전부 FAILED 로 닫는다."""
        return self._fail_where(AnalysisJob.status.in_(_ACTIVE), code=code, message=message)

    def requeue_expired_leases(self, *, max_attempts: int) -> int:
        """재시도 여지가 있는 만료 RUNNING 작업을 다시 QUEUED 로 돌린다.

        UPDATE 자체에도 만료·상태·시도 횟수 조건을 모두 둔다. SELECT 뒤 상태가 바뀌는 식의
        경쟁 창이 없어, 동시에 복구하는 여러 워커 중 실제 조건을 만족한 행만 갱신된다.
        """
        now = datetime.now(UTC)
        recovered = self.db.execute(
            update(AnalysisJob)
            .where(
                AnalysisJob.status == JobStatus.RUNNING.value,
                AnalysisJob.lease_expires_at.is_not(None),
                AnalysisJob.lease_expires_at < now,
                AnalysisJob.attempt_count < max_attempts,
            )
            .values(
                status=JobStatus.QUEUED.value,
                locked_by=None,
                lease_expires_at=None,
                heartbeat_at=None,
                queued_at=now,
                updated_at=now,
            )
            .execution_options(synchronize_session=False)
        )
        self.db.commit()
        return recovered.rowcount or 0

    def fail_expired_leases(
        self,
        *,
        code: str,
        message: str,
        min_attempts: int | None = None,
    ) -> list[tuple[uuid.UUID, uuid.UUID]]:
        """재시도 한도를 소진한, lease 가 끊긴 RUNNING 작업을 실패로 닫는다."""
        condition = (
            (AnalysisJob.status == JobStatus.RUNNING.value)
            & (AnalysisJob.lease_expires_at.is_not(None))
            & (AnalysisJob.lease_expires_at < datetime.now(UTC))
        )
        if min_attempts is not None:
            condition &= AnalysisJob.attempt_count >= min_attempts
        return self._fail_where(condition, code=code, message=message)

    def _fail_where(
        self, condition, *, code: str, message: str
    ) -> list[tuple[uuid.UUID, uuid.UUID]]:
        now = utcnow()
        rows = list(
            self.db.execute(
                update(AnalysisJob)
                .where(condition)
                .values(
                    status=JobStatus.FAILED.value,
                    error_code=code,
                    error_message=message,
                    finished_at=now,
                    updated_at=now,
                    lease_expires_at=None,
                )
                .returning(AnalysisJob.id, AnalysisJob.user_id)
                .execution_options(synchronize_session=False)
            ).all()
        )
        self.db.commit()
        return [(r[0], r[1]) for r in rows]
