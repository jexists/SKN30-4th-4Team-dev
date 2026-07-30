"""분석 작업 워커.

analysis_job 테이블을 큐로 삼아 QUEUED 를 하나씩 선점(claim)해 처리한다. Redis·Celery 없이
DB 만으로 굴러가고, `FOR UPDATE SKIP LOCKED` + 조건부 UPDATE 덕분에 uvicorn worker 를 여러 개로
늘려도 같은 작업이 두 번 실행되지 않는다.

**재시도는 워커가 살아 있는 동안만 한다.** 업로드 원본은 private Storage에 있어 어느
백엔드든 읽을 수 있다. 기동 시 다른 워커의 정상 작업을 건드리지 않고, lease가 만료된
RUNNING 작업만 실패로 닫는다(recover 참고).
"""

import logging
import os
import random
import socket
import threading
import time
import uuid
from collections.abc import Callable

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import AppError
from app.db.session import AppSessionLocal
from app.models.analysis_job import JobStage
from app.repositories.analysis_job import AnalysisJobRepository
from app.services.analysis_jobs import pipeline
from app.services.analysis_jobs import storage as analysis_storage
from app.services.notification import notify_analysis_completed, notify_analysis_failed

logger = logging.getLogger(__name__)

SessionFactory = Callable[[], Session]

# 이 상태 코드는 "다시 하면 될 수도 있다" 는 뜻이다 — OpenAI 429/5xx, OCR worker 연결 실패 등.
# 4xx(지원하지 않는 형식·크기 초과·개인정보 잔존)는 몇 번을 해도 결과가 같으므로 즉시 닫는다.
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})

_LEASE_MESSAGE = "분석이 예상보다 오래 걸려 중단되었습니다. 다시 시도해 주세요."
_UNEXPECTED_MESSAGE = "분석 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."


def _worker_id(slot: int) -> str:
    """어느 프로세스의 어느 스레드가 잡았는지 로그·DB 에서 알아볼 수 있게."""
    return f"{socket.gethostname()}:{os.getpid()}:{slot}"


def _is_retryable(exc: BaseException) -> bool:
    if isinstance(exc, AppError):
        return exc.code in RETRYABLE_STATUS
    # 예상 못한 예외는 일시적일 수 있으니 재시도 대상으로 둔다(원인은 로그에 남는다).
    return True


def _backoff_seconds(attempt: int) -> float:
    """exponential backoff + jitter. 여러 워커가 동시에 재시도해 몰리지 않게 흔든다."""
    raw = settings.ANALYSIS_RETRY_BASE_SECONDS * (2 ** (attempt - 1))
    capped = min(raw, settings.ANALYSIS_RETRY_MAX_SECONDS)
    return capped * (0.5 + random.random() / 2)  # noqa: S311 - 보안용 난수가 아니다


class AnalysisWorker:
    """폴링 스레드 묶음. 테스트는 session_factory 를 주입하고 run_once 를 직접 부른다."""

    def __init__(self, session_factory: SessionFactory | None = None):
        self._session_factory = session_factory
        self._stop = threading.Event()
        self._threads: list[threading.Thread] = []

    # ── 수명 주기 ───────────────────────────────────────────────────

    def start(self) -> bool:
        if self._session_factory is None:
            self._session_factory = AppSessionLocal
        if self._session_factory is None:
            logger.info("APP_DB_URL 미설정 — 분석 워커를 띄우지 않는다")
            return False
        if self._threads:
            return True
        self._stop.clear()
        for slot in range(settings.ANALYSIS_WORKER_CONCURRENCY):
            # 데몬 스레드 — 기존 워밍업과 같은 이유로 종료를 붙잡지 않는다(--reload 루프 보호).
            thread = threading.Thread(
                target=self._loop, args=(slot,), name=f"analysis-{slot}", daemon=True
            )
            thread.start()
            self._threads.append(thread)
        logger.info("분석 워커 기동 concurrency=%d", settings.ANALYSIS_WORKER_CONCURRENCY)
        return True

    def stop(self) -> None:
        self._stop.set()
        self._threads.clear()

    def _loop(self, slot: int) -> None:
        worker_id = _worker_id(slot)
        while not self._stop.is_set():
            try:
                did_work = self.run_once(worker_id)
            except Exception:
                # 루프 자체가 죽으면 큐가 영원히 멈춘다 — 무슨 일이 있어도 계속 돈다.
                logger.exception("분석 워커 루프 오류 worker_id=%s", worker_id)
                did_work = False
            if not did_work:
                self._stop.wait(settings.ANALYSIS_POLL_INTERVAL_SECONDS)

    # ── 한 건 처리 ──────────────────────────────────────────────────

    def run_once(self, worker_id: str = "worker") -> bool:
        """작업 하나를 선점해 처리한다. 처리했으면 True, 큐가 비었으면 False."""
        factory = self._session_factory or AppSessionLocal
        if factory is None:
            return False

        with factory() as db:
            recover_expired_leases(db)
            job = AnalysisJobRepository(db).claim_next(
                worker_id, lease_seconds=settings.ANALYSIS_JOB_LEASE_SECONDS
            )
            if job is None:
                return False
            job_id, user_id = job.id, job.user_id
            file_names = list(job.file_names or [])
            attempt = job.attempt_count

        started = time.perf_counter()
        try:
            with factory() as db:
                self._process(db, job_id, user_id, file_names, attempt, worker_id)
        finally:
            analysis_storage.discard_job(user_id, job_id, file_names)
            logger.info(
                "분석 작업 종료 job_id=%s user_id=%s worker_id=%s elapsed=%.1fs",
                job_id,
                user_id,
                worker_id,
                time.perf_counter() - started,
            )
        return True

    def _process(
        self,
        db: Session,
        job_id: uuid.UUID,
        user_id: uuid.UUID,
        file_names: list[str],
        attempt: int,
        worker_id: str,
    ) -> None:
        repo = AnalysisJobRepository(db)

        def on_stage(stage: str, progress: int) -> None:
            repo.set_stage(job_id, stage, progress)
            # 오래 걸리는 단계 사이에 lease 를 연장한다. OCR 한 건이 lease 보다 길어지면
            # 다른 워커가 좀비로 오인해 회수하므로, 파일 하나 끝날 때마다 갱신한다.
            repo.heartbeat(job_id, lease_seconds=settings.ANALYSIS_JOB_LEASE_SECONDS)

        while True:
            try:
                result = pipeline.run_analysis(user_id, job_id, file_names, on_stage=on_stage)
            except Exception as exc:
                retryable = _is_retryable(exc)
                logger.warning(
                    "분석 실패 job_id=%s user_id=%s worker_id=%s attempt=%d retryable=%s",
                    job_id,
                    user_id,
                    worker_id,
                    attempt,
                    retryable,
                    exc_info=True,
                )
                if retryable and attempt < settings.ANALYSIS_JOB_MAX_ATTEMPTS:
                    attempt += 1
                    repo.set_attempt(job_id, attempt)
                    repo.set_stage(job_id, JobStage.OCR.value, 5)
                    time.sleep(_backoff_seconds(attempt))
                    continue
                self._fail(db, job_id, user_id, exc)
                return

            title, summary, risk_level = pipeline.summarize(result, file_names)
            repo.mark_succeeded(
                job_id,
                user_id,
                payload=result.model_dump(),
                title=title,
                summary=summary,
                risk_level=risk_level,
            )
            # 상태를 먼저 커밋한 뒤 알림 — "알림은 왔는데 결과가 없다" 를 구조적으로 막는다.
            notify_analysis_completed(db, user_id, job_id)
            return

    def _fail(self, db: Session, job_id: uuid.UUID, user_id: uuid.UUID, exc: BaseException) -> None:
        if isinstance(exc, AppError):
            code, message = str(exc.code), exc.message
        else:
            code, message = "UNEXPECTED", _UNEXPECTED_MESSAGE
        AnalysisJobRepository(db).mark_failed(job_id, code=code, message=message)
        notify_analysis_failed(db, user_id, job_id)


#: 앱이 쓰는 단일 워커. 테스트는 자기 인스턴스를 만든다.
worker = AnalysisWorker()


def recover_expired_leases(db: Session) -> int:
    """lease 가 끊긴 RUNNING 작업을 실패로 닫고 알림을 만든다."""
    stale = AnalysisJobRepository(db).fail_expired_leases(
        code="LEASE_EXPIRED", message=_LEASE_MESSAGE
    )
    for job_id, user_id in stale:
        logger.warning("lease 만료로 분석 작업 회수 job_id=%s user_id=%s", job_id, user_id)
        notify_analysis_failed(db, user_id, job_id)
    return len(stale)


def recover_on_startup(db: Session) -> int:
    """기동 시 lease가 이미 만료된 작업만 정리한다.

    QUEUED와 정상 lease의 RUNNING은 다른 백엔드가 처리 중일 수 있다. 원본이 공유 Storage에
    있으므로 서버 하나가 시작됐다는 이유로 전역 작업을 실패시키면 안 된다.
    """
    return recover_expired_leases(db)
