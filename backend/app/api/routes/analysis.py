"""분석 작업 API — 접수(202)·목록·상세·제목 수정·삭제.

분석은 **여기서 실행하지 않는다.** 검증하고 파일을 공유 입력 저장소에 올린 뒤
analysis_job 행 하나를 만들고 바로 응답한다. 실제 처리는 services/analysis_jobs/runner.py 의
워커가 큐에서 집어간다.
"""

import logging
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Header, Query, UploadFile
from sqlalchemy.orm import Session

from app.api.cursor import decode_cursor, encode_cursor
from app.api.deps import RequireMember
from app.core.config import settings
from app.core.exceptions import AppError
from app.db.session import get_app_db
from app.models.analysis_job import ACTIVE_STATUSES, AnalysisJob, AnalysisResult, JobStatus
from app.models.auth import utcnow
from app.repositories.analysis_job import AnalysisJobRepository
from app.schemas.analysis import (
    AnalysisErrorOut,
    AnalysisJobDetailOut,
    AnalysisJobOut,
    AnalysisJobSummaryOut,
    AnalysisResultOut,
    UpdateAnalysisTitleIn,
)
from app.schemas.common import ApiResponse, Page, success_response
from app.services.analysis_jobs import input_store
from app.services.auth import claims_user_id
from app.services.notification import notify_analysis_started

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analyses", tags=["analyses"])

AppDb = Annotated[Session, Depends(get_app_db)]
Limit = Annotated[int, Query(ge=1, le=100)]

ALLOWED_SUFFIXES = frozenset({".pdf", ".png", ".jpg", ".jpeg"})

# 없는 작업·남의 작업·잘못된 UUID 를 한 문구로 묶는다(존재 여부를 알려주지 않는다).
_JOB_NOT_FOUND = "이미 삭제되었거나 존재하지 않는 분석입니다."


@router.post("", response_model=ApiResponse[AnalysisJobOut], status_code=202)
def start_analysis(
    file: Annotated[list[UploadFile], File()],
    user: RequireMember,
    db: AppDb,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> ApiResponse[AnalysisJobOut]:
    """분석을 접수하고 즉시 202 로 작업 id 를 돌려준다.

    파일 형식·개수·크기처럼 **바로 알 수 있는 문제는 여기서 동기로 막는다** — 이런 걸
    알림으로 알리면 사용자는 한참 뒤에야 오타를 알게 된다. 시간이 걸리는 OCR·LLM 만 넘긴다.
    """
    uid = claims_user_id(user)
    repo = AnalysisJobRepository(db)

    # 같은 요청의 재전송(더블클릭·네트워크 재시도)은 새 작업을 만들지 않고 원래 작업을 돌려준다.
    if idempotency_key:
        existing = repo.find_by_idempotency_key(uid, idempotency_key)
        if existing is not None:
            return success_response(_job_out(existing))

    if repo.find_active(uid) is not None:
        raise AppError(
            "분석이 이미 진행 중입니다",
            "진행 중인 분석이 끝나면 새로 요청할 수 있습니다.",
            409,
        )

    payloads = _read_uploads(file)

    # job_id 를 먼저 정해 파일을 다 올린 **뒤에** 행을 만든다. 순서를 뒤집으면 워커가 입력이
    # 아직 없는 QUEUED 를 집어갈 수 있다.
    job_id = uuid.uuid4()
    input_store.store_all(uid, job_id, payloads)

    # flush 까지는 커밋 여부가 확실히 false 이므로 실패하면 입력도 지운다. 응답에 필요한
    # ORM 값은 commit 전에 모두 읽어 둔다 — commit 뒤 refresh 는 "커밋은 됐지만 응답 조립이
    # 실패한" 애매한 상태를 만들고, 워커가 이미 선점한 행을 refresh 할 수도 있다.
    try:
        job = repo.create(
            uid,
            job_id=job_id,
            file_names=[name for name, _ in payloads],
            idempotency_key=idempotency_key,
        )
        db.flush()
        response = success_response(_job_out(job))
    except Exception:
        db.rollback()
        input_store.discard(uid, job_id, count=len(payloads))
        raise

    # commit 예외는 서버가 성공 응답을 받지 못했어도 DB 쪽 커밋은 완료됐을 수 있다. 이때
    # 입력을 지우면 실제로 존재하는 QUEUED 가 영구 실패하므로 보수적으로 남겨 둔다.
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    # 작업이 커밋된 뒤에 알림 — 실패해도 접수는 유효하다(서비스가 예외를 삼킨다).
    notify_analysis_started(db, uid, job_id)
    # message 를 비우는 이유: 프론트가 안내 Modal 을 띄우므로 토스트까지 뜨면
    # 같은 말이 두 번 나온다.
    return response


@router.get("", response_model=ApiResponse[Page[AnalysisJobSummaryOut]])
def list_analyses(
    user: RequireMember, db: AppDb, limit: Limit = 30, cursor: str | None = None
) -> ApiResponse[Page[AnalysisJobSummaryOut]]:
    """내 분석 목록 (최신순, 커서 페이지네이션)."""
    uid = claims_user_id(user)
    rows, has_more = AnalysisJobRepository(db).list_by_user(
        uid, limit=limit, cursor=decode_cursor(cursor)
    )
    next_cursor = (
        encode_cursor(rows[-1][0].created_at, rows[-1][0].id) if has_more and rows else None
    )
    return success_response(
        Page(items=[_summary_out(job, result) for job, result in rows], next_cursor=next_cursor)
    )


@router.get("/{job_id}", response_model=ApiResponse[AnalysisJobDetailOut])
def get_analysis(job_id: str, user: RequireMember, db: AppDb) -> ApiResponse[AnalysisJobDetailOut]:
    """작업 상태 + (끝났으면) 결과.

    결과를 따로 떼지 않은 이유: 프론트가 상태를 폴링하다 SUCCEEDED 를 본 **그 응답**에 결과가
    들어 있어야 화면이 한 번에 그려진다.
    """
    uid = claims_user_id(user)
    repo = AnalysisJobRepository(db)
    job = _get_owned_or_404(repo, job_id, uid)
    result = repo.get_result(job.id) if job.status == JobStatus.SUCCEEDED else None
    return success_response(_detail_out(job, result))


@router.put("/{job_id}/title", response_model=ApiResponse[AnalysisJobSummaryOut])
def update_analysis_title(
    job_id: str, body: UpdateAnalysisTitleIn, user: RequireMember, db: AppDb
) -> ApiResponse[AnalysisJobSummaryOut]:
    """목록에 보이는 제목을 사용자가 고친다.

    제목은 산출물(analysis_result)의 컬럼이다 — 아직 결과가 없는 작업(진행 중·실패)은 고칠
    자리가 없으므로 409 로 거절한다. 목록에서도 그 행에는 '제목 수정' 메뉴를 띄우지 않는다.
    """
    uid = claims_user_id(user)
    repo = AnalysisJobRepository(db)
    job = _get_owned_or_404(repo, job_id, uid)

    result = repo.get_result(job.id)
    if result is None:
        raise AppError("제목을 수정할 수 없습니다", "아직 분석 결과가 없는 기록입니다.", 409)

    result.title = body.title
    result.updated_at = utcnow()
    db.commit()
    db.refresh(result)
    # message 는 토스트 문구다 — 프론트가 화면마다 따로 심지 않도록 서버가 소유한다.
    return success_response(_summary_out(job, result), message="분석 제목을 수정했습니다.")


@router.delete("/{job_id}", response_model=ApiResponse[AnalysisJobSummaryOut])
def delete_analysis(
    job_id: str, user: RequireMember, db: AppDb
) -> ApiResponse[AnalysisJobSummaryOut]:
    """목록에서 지운다 — soft delete 라 deleted_at 만 찍고 행도 산출물도 남긴다.

    조회 경로(get_owned·_owned)가 이미 deleted_at IS NULL 로 거르므로 이후 접근은 전부 404 다.
    (db.delete() 를 쓰면 analysis_result 가 ON DELETE CASCADE 로 함께 날아간다 — 쓰지 않는다.)

    **진행 중인 작업은 지울 수 없다.** 워커도 DB 의 uq_analysis_job_active 도 deleted_at 을
    모르기 때문에, 숨겨둔 채로 돌고 있는 작업이 있으면 그 회원은 새 분석을 시작할 수 없다.
    """
    uid = claims_user_id(user)
    repo = AnalysisJobRepository(db)
    job = _get_owned_or_404(repo, job_id, uid)

    if job.status in ACTIVE_STATUSES:
        raise AppError("삭제할 수 없습니다", "분석이 끝난 뒤에 삭제할 수 있습니다.", 409)

    now = utcnow()
    job.deleted_at = now
    job.updated_at = now
    db.commit()
    db.refresh(job)
    return success_response(
        _summary_out(job, repo.get_result(job.id)), message="분석 기록을 삭제했습니다."
    )


# ── 조립 ──────────────────────────────────────────────────────────────


def _get_owned_or_404(repo: AnalysisJobRepository, job_id: str, user_id: uuid.UUID) -> AnalysisJob:
    """없는 작업·남의 작업·이미 지운 작업·잘못된 UUID 를 한 문구의 404 로 묶는다."""
    try:
        jid = uuid.UUID(job_id)
    except ValueError as e:
        raise AppError("분석을 찾을 수 없습니다", _JOB_NOT_FOUND, 404) from e

    job = repo.get_owned(jid, user_id)
    if job is None:
        # 남의 작업도 404 다 — 403 이면 "그 id 는 존재한다" 를 알려주는 셈이다.
        raise AppError("분석을 찾을 수 없습니다", _JOB_NOT_FOUND, 404)
    return job


def _read_uploads(uploads: list[UploadFile]) -> list[tuple[str, bytes]]:
    """업로드를 검증하며 메모리로 읽는다. 한 번에 한 파일만 들고 있는다."""
    if len(uploads) > settings.CONTRACT_MAX_FILES:
        raise AppError(
            "파일 개수 초과",
            f"서류는 최대 {settings.CONTRACT_MAX_FILES}개까지 업로드할 수 있습니다.",
            413,
        )
    if not uploads:
        raise AppError("서류 없음", "분석할 서류를 한 개 이상 올려 주세요.", 422)

    max_bytes = settings.CONTRACT_MAX_FILE_MB * 1024 * 1024
    payloads: list[tuple[str, bytes]] = []
    for index, upload in enumerate(uploads, start=1):
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise AppError(
                "지원하지 않는 파일", "모든 서류는 PDF, PNG, JPG 형식이어야 합니다.", 415
            )
        content = upload.file.read(max_bytes + 1)
        if not content:
            raise AppError("빈 파일", f"{index}번째 서류에 내용이 없습니다.", 422)
        if len(content) > max_bytes:
            raise AppError(
                "파일 크기 초과",
                f"각 서류는 최대 {settings.CONTRACT_MAX_FILE_MB}MB까지 업로드할 수 있습니다.",
                413,
            )
        payloads.append((Path(upload.filename or f"document-{index}{suffix}").name, content))
    return payloads


def _job_out(job: AnalysisJob) -> AnalysisJobOut:
    return AnalysisJobOut(id=job.id, status=job.status, created_at=job.created_at)


def _summary_out(job: AnalysisJob, result: AnalysisResult | None) -> AnalysisJobSummaryOut:
    return AnalysisJobSummaryOut(
        id=job.id,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        file_names=list(job.file_names or []),
        title=result.title if result else None,
        risk_level=result.risk_level if result else None,
        created_at=job.created_at,
        finished_at=job.finished_at,
    )


def _detail_out(job: AnalysisJob, result: AnalysisResult | None) -> AnalysisJobDetailOut:
    base = _summary_out(job, result)
    error = (
        AnalysisErrorOut(code=job.error_code, message=job.error_message)
        if job.status == JobStatus.FAILED and job.error_message
        else None
    )
    return AnalysisJobDetailOut(
        **base.model_dump(),
        summary=result.summary if result else None,
        attempt_count=job.attempt_count,
        result=AnalysisResultOut.model_validate(result.payload) if result else None,
        error=error,
    )
