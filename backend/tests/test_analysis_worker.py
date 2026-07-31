"""분석 작업 큐 워커 — 선점·재시도·실패·복구."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.core.exceptions import AppError
from app.db.base import Base
from app.models.analysis_job import AnalysisJob, AnalysisResult, JobStatus
from app.models.notification import Notification, NotificationType
from app.repositories.analysis_job import AnalysisJobRepository
from app.repositories.auth import AuthRepository
from app.schemas.analysis import AnalysisResultOut
from app.schemas.document import ContractLlmAnalysis, ContractRiskIssue, ContractTerms
from app.services.analysis_jobs import pipeline, runner

FILE_NAMES = ["계약서.pdf"]


@pytest.fixture(autouse=True)
def _fast_retries(monkeypatch):
    """재시도 backoff 를 사실상 0 으로 — 테스트가 실제로 기다릴 이유가 없다."""
    monkeypatch.setattr(settings, "ANALYSIS_RETRY_BASE_SECONDS", 0.001)
    monkeypatch.setattr(settings, "ANALYSIS_RETRY_MAX_SECONDS", 0.001)
    monkeypatch.setattr(settings, "ANALYSIS_JOB_MAX_ATTEMPTS", 3)


@pytest.fixture(autouse=True)
def discarded_inputs(monkeypatch):
    """테스트가 원격 Storage 를 건드리지 않게 하고 최종 정리 시점을 관찰한다."""
    calls: list[tuple[uuid.UUID, uuid.UUID, int]] = []
    monkeypatch.setattr(runner.input_store, "discard", lambda *args: calls.append(args))
    return calls


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture()
def user(session_factory) -> uuid.UUID:
    user_id = uuid.uuid4()
    with session_factory() as db:
        AuthRepository(db).add_app_user(user_id)
        db.commit()
    return user_id


def _queue_job(session_factory, user_id: uuid.UUID, *, notify: bool = True) -> uuid.UUID:
    with session_factory() as db:
        job = AnalysisJobRepository(db).create(user_id, file_names=FILE_NAMES, notify=notify)
        db.commit()
        return job.id


def _fake_result(summary: str = "요약", severity: str = "HIGH") -> AnalysisResultOut:
    return AnalysisResultOut(
        sanitized_text="본문",
        redaction_counts={"NAME": 1},
        redaction_scope=["NAME"],
        mask_count=1,
        coarse_mask_count=0,
        review_required=False,
        documents=[],
        analysis=ContractLlmAnalysis(
            summary=summary,
            terms=ContractTerms(property_type="아파트"),
            risks=[
                ContractRiskIssue(
                    severity=severity, title="위험", reason="사유", recommendation="조치"
                )
            ],
        ),
    )


def _job(session_factory, job_id: uuid.UUID) -> AnalysisJob:
    with session_factory() as db:
        return db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id)).scalar_one()


def _notification_types(session_factory) -> list[str]:
    with session_factory() as db:
        return [n.type for n in db.execute(select(Notification)).scalars().all()]


# ── 선점 ──────────────────────────────────────────────────────────────


def test_empty_queue_returns_false(session_factory):
    assert runner.AnalysisWorker(session_factory).run_once() is False


def test_only_one_worker_claims_a_job(session_factory, user):
    _queue_job(session_factory, user)

    with session_factory() as db1, session_factory() as db2:
        first = AnalysisJobRepository(db1).claim_next("w1", lease_seconds=60)
        second = AnalysisJobRepository(db2).claim_next("w2", lease_seconds=60)

    assert first is not None
    assert second is None, "두 워커가 같은 작업을 잡았다"
    assert first.status == JobStatus.RUNNING
    assert first.locked_by == "w1"
    assert first.attempt_count == 1


def test_active_job_blocks_a_second_one(session_factory, user):
    _queue_job(session_factory, user)
    with session_factory() as db:
        assert AnalysisJobRepository(db).find_active(user) is not None


# ── 성공 ──────────────────────────────────────────────────────────────


def test_success_stores_result_and_notifies(session_factory, user, monkeypatch, discarded_inputs):
    job_id = _queue_job(session_factory, user)
    monkeypatch.setattr(pipeline, "run_analysis", lambda *a, **k: _fake_result())

    assert runner.AnalysisWorker(session_factory).run_once() is True

    job = _job(session_factory, job_id)
    assert job.status == JobStatus.SUCCEEDED
    assert job.progress == 100
    assert job.finished_at is not None
    assert job.error_code is None

    with session_factory() as db:
        result = db.execute(select(AnalysisResult)).scalar_one()
        assert result.job_id == job_id
        assert result.user_id == user
        assert result.title == "아파트"
        assert result.risk_level == "HIGH"
        assert result.payload["analysis"]["summary"] == "요약"

    assert _notification_types(session_factory) == [NotificationType.ANALYSIS_COMPLETED]
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_silent_job_succeeds_without_notifying(
    session_factory, user, monkeypatch, discarded_inputs
):
    """채팅 첨부(notify=false)는 대화 안에서 결과를 보여주므로 알림을 만들지 않는다.

    다만 결과 저장과 입력 정리는 알림 여부와 무관하게 그대로 돌아야 한다 — 여기가 무너지면
    원본 파일이 공유 저장소에 영영 남는다.
    """
    job_id = _queue_job(session_factory, user, notify=False)
    monkeypatch.setattr(pipeline, "run_analysis", lambda *a, **k: _fake_result())

    assert runner.AnalysisWorker(session_factory).run_once() is True

    assert _job(session_factory, job_id).status == JobStatus.SUCCEEDED
    with session_factory() as db:
        assert db.execute(select(AnalysisResult)).scalar_one().job_id == job_id
    assert _notification_types(session_factory) == []
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_silent_job_fails_without_notifying(session_factory, user, monkeypatch, discarded_inputs):
    job_id = _queue_job(session_factory, user, notify=False)
    monkeypatch.setattr(
        pipeline,
        "run_analysis",
        lambda *a, **k: (_ for _ in ()).throw(AppError("실패", "개인정보가 남아 있습니다.", 422)),
    )

    runner.AnalysisWorker(session_factory).run_once()

    job = _job(session_factory, job_id)
    assert job.status == JobStatus.FAILED
    assert job.error_message == "개인정보가 남아 있습니다."
    assert _notification_types(session_factory) == []
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_risk_level_falls_back_to_low_when_no_high_or_medium(session_factory, user, monkeypatch):
    _queue_job(session_factory, user)
    monkeypatch.setattr(pipeline, "run_analysis", lambda *a, **k: _fake_result(severity="LOW"))

    runner.AnalysisWorker(session_factory).run_once()

    with session_factory() as db:
        assert db.execute(select(AnalysisResult)).scalar_one().risk_level == "LOW"


# ── 실패·재시도 ────────────────────────────────────────────────────────


def test_user_input_error_fails_immediately_without_retry(
    session_factory, user, monkeypatch, discarded_inputs
):
    """4xx 는 몇 번을 해도 결과가 같다 — 재시도하면 사용자만 기다린다."""
    job_id = _queue_job(session_factory, user)
    calls = []

    def boom(*args, **kwargs):
        calls.append(1)
        raise AppError("개인정보 검토 필요", "개인정보가 남아 있습니다.", 422)

    monkeypatch.setattr(pipeline, "run_analysis", boom)
    runner.AnalysisWorker(session_factory).run_once()

    assert len(calls) == 1, "4xx 인데 재시도했다"
    job = _job(session_factory, job_id)
    assert job.status == JobStatus.FAILED
    assert job.error_code == "422"
    assert job.error_message == "개인정보가 남아 있습니다."
    assert _notification_types(session_factory) == [NotificationType.ANALYSIS_FAILED]
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_transient_error_is_retried_then_fails(
    session_factory, user, monkeypatch, discarded_inputs
):
    job_id = _queue_job(session_factory, user)
    calls = []

    def boom(*args, **kwargs):
        calls.append(1)
        raise AppError("OCR 서버 연결 실패", "잠시 후 다시 시도해 주세요.", 503)

    monkeypatch.setattr(pipeline, "run_analysis", boom)
    runner.AnalysisWorker(session_factory).run_once()

    assert len(calls) == settings.ANALYSIS_JOB_MAX_ATTEMPTS
    job = _job(session_factory, job_id)
    assert job.status == JobStatus.FAILED
    assert job.attempt_count == settings.ANALYSIS_JOB_MAX_ATTEMPTS
    assert _notification_types(session_factory) == [NotificationType.ANALYSIS_FAILED]
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_transient_error_then_success(session_factory, user, monkeypatch, discarded_inputs):
    job_id = _queue_job(session_factory, user)
    calls = []

    def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            assert discarded_inputs == [], "프로세스 내부 재시도 전에 입력을 지웠다"
            raise AppError("OCR 서버 연결 실패", "잠시 후 다시 시도해 주세요.", 503)
        return _fake_result()

    monkeypatch.setattr(pipeline, "run_analysis", flaky)
    runner.AnalysisWorker(session_factory).run_once()

    assert len(calls) == 2
    assert _job(session_factory, job_id).status == JobStatus.SUCCEEDED
    assert _notification_types(session_factory) == [NotificationType.ANALYSIS_COMPLETED]
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_worker_loads_inputs_by_user_job_and_index(session_factory, user, monkeypatch):
    job_id = _queue_job(session_factory, user)
    loads = []

    def load(load_user_id, load_job_id, index):
        loads.append((load_user_id, load_job_id, index))
        return b"stored-input"

    def analyze(file_names, *, load_file, on_stage):
        assert file_names == FILE_NAMES
        assert load_file(0) == b"stored-input"
        return _fake_result()

    monkeypatch.setattr(runner.input_store, "load", load)
    monkeypatch.setattr(pipeline, "run_analysis", analyze)

    runner.AnalysisWorker(session_factory).run_once()

    assert loads == [(user, job_id, 0)]


def test_unexpected_exception_never_leaks_internals_to_the_user(session_factory, user, monkeypatch):
    """예외 문자열은 그대로 화면에 뜬다 — 내부 메시지가 새면 안 된다."""
    job_id = _queue_job(session_factory, user)

    def boom(*args, **kwargs):
        raise RuntimeError("postgres://user:secret@host/db 접속 실패")

    monkeypatch.setattr(pipeline, "run_analysis", boom)
    runner.AnalysisWorker(session_factory).run_once()  # 예외가 밖으로 새면 안 된다

    job = _job(session_factory, job_id)
    assert job.status == JobStatus.FAILED
    assert job.error_code == "UNEXPECTED"
    assert "secret" not in (job.error_message or "")
    assert job.error_message == runner._UNEXPECTED_MESSAGE


# ── 복구 ──────────────────────────────────────────────────────────────


def test_startup_recovery_preserves_queued_and_live_jobs(session_factory, user):
    job_id = _queue_job(session_factory, user)

    with session_factory() as db:
        assert runner.recover_on_startup(db) == 0
    assert _job(session_factory, job_id).status == JobStatus.QUEUED

    with session_factory() as db:
        AnalysisJobRepository(db).claim_next("live-worker", lease_seconds=3600)
    with session_factory() as db:
        assert runner.recover_on_startup(db) == 0

    job = _job(session_factory, job_id)
    assert job.status == JobStatus.RUNNING
    assert job.locked_by == "live-worker"
    assert _notification_types(session_factory) == []


def test_expired_lease_is_requeued_and_claimed_by_another_worker(session_factory, user):
    job_id = _queue_job(session_factory, user)
    with session_factory() as db:
        AnalysisJobRepository(db).claim_next("w1", lease_seconds=60)
    with session_factory() as db:
        job = db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id)).scalar_one()
        job.lease_expires_at = datetime.now(UTC) - timedelta(minutes=5)
        db.commit()

    with session_factory() as db:
        assert runner.recover_expired_leases(db) == 1

    job = _job(session_factory, job_id)
    assert job.status == JobStatus.QUEUED
    assert job.locked_by is None
    assert job.lease_expires_at is None
    assert job.heartbeat_at is None
    assert job.attempt_count == 1

    with session_factory() as db:
        reclaimed = AnalysisJobRepository(db).claim_next("w2", lease_seconds=60)
    assert reclaimed is not None
    assert reclaimed.id == job_id
    assert reclaimed.status == JobStatus.RUNNING
    assert reclaimed.locked_by == "w2"
    assert reclaimed.attempt_count == 2


def test_expired_lease_at_attempt_limit_fails_and_discards_inputs(
    session_factory, user, discarded_inputs
):
    job_id = _queue_job(session_factory, user)
    with session_factory() as db:
        AnalysisJobRepository(db).claim_next("w1", lease_seconds=60)
    with session_factory() as db:
        job = db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id)).scalar_one()
        job.attempt_count = settings.ANALYSIS_JOB_MAX_ATTEMPTS
        job.lease_expires_at = datetime.now(UTC) - timedelta(minutes=5)
        db.commit()

    with session_factory() as db:
        assert runner.recover_expired_leases(db) == 1

    job = _job(session_factory, job_id)
    assert job.status == JobStatus.FAILED
    assert job.error_code == "LEASE_EXPIRED"
    assert _notification_types(session_factory) == [NotificationType.ANALYSIS_FAILED]
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_expired_lease_of_silent_job_does_not_notify(session_factory, user, discarded_inputs):
    """lease 만료 경로도 job.notify 를 본다 — 여기만 빠뜨리면 채팅 첨부가 타임아웃될 때
    알림이 샌다."""
    job_id = _queue_job(session_factory, user, notify=False)
    with session_factory() as db:
        AnalysisJobRepository(db).claim_next("w1", lease_seconds=60)
    with session_factory() as db:
        job = db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id)).scalar_one()
        job.attempt_count = settings.ANALYSIS_JOB_MAX_ATTEMPTS
        job.lease_expires_at = datetime.now(UTC) - timedelta(minutes=5)
        db.commit()

    with session_factory() as db:
        assert runner.recover_expired_leases(db) == 1

    assert _job(session_factory, job_id).status == JobStatus.FAILED
    assert _notification_types(session_factory) == []
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_expired_lease_recovery_is_idempotent(session_factory, user, discarded_inputs):
    job_id = _queue_job(session_factory, user)
    with session_factory() as db:
        AnalysisJobRepository(db).claim_next("w1", lease_seconds=60)
    with session_factory() as db:
        job = db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id)).scalar_one()
        job.attempt_count = settings.ANALYSIS_JOB_MAX_ATTEMPTS
        job.lease_expires_at = datetime.now(UTC) - timedelta(minutes=5)
        db.commit()

    with session_factory() as db:
        assert runner.recover_expired_leases(db) == 1
    with session_factory() as db:
        assert runner.recover_expired_leases(db) == 0

    assert _notification_types(session_factory) == [NotificationType.ANALYSIS_FAILED]
    assert discarded_inputs == [(user, job_id, len(FILE_NAMES))]


def test_live_lease_is_left_alone(session_factory, user):
    _queue_job(session_factory, user)
    with session_factory() as db:
        AnalysisJobRepository(db).claim_next("w1", lease_seconds=3600)

    with session_factory() as db:
        assert runner.recover_expired_leases(db) == 0


def test_after_failure_user_can_queue_again(session_factory, user, monkeypatch):
    """진행 중 1건 제약이 실패한 작업까지 막으면 사용자가 영원히 갇힌다."""
    _queue_job(session_factory, user)
    monkeypatch.setattr(
        pipeline, "run_analysis", lambda *a, **k: (_ for _ in ()).throw(AppError("x", "y", 422))
    )
    runner.AnalysisWorker(session_factory).run_once()

    with session_factory() as db:
        assert AnalysisJobRepository(db).find_active(user) is None
        AnalysisJobRepository(db).create(user, file_names=FILE_NAMES)
        db.commit()  # 제약에 걸리지 않아야 한다
