"""분석 접수 API — 202·중복 방지·소유권·입력 검증."""

import uuid

import pytest
from sqlalchemy import select

from app.api.deps import require_user
from app.core.config import settings
from app.main import app
from app.models.analysis_job import AnalysisJob, AnalysisResult, JobStatus
from app.models.notification import Notification, NotificationType
from app.services.analysis_jobs import spool

PDF = ("contract.pdf", b"fake-pdf", "application/pdf")


@pytest.fixture(autouse=True)
def _isolated_spool(tmp_path, monkeypatch):
    """스풀을 테스트별 임시 폴더로 — 진짜 temp 디렉터리를 어지럽히지 않는다."""
    monkeypatch.setattr(spool, "SPOOL_ROOT", tmp_path / "spool")


@pytest.fixture()
def member(client, register_member):
    """가입 완료 회원으로 인증된 client. RequireMember 가드를 통과한다."""
    user_id = register_member()
    app.dependency_overrides[require_user] = lambda: {"sub": str(user_id)}
    return client, user_id


def _post(client, files=None, **kwargs):
    return client.post("/api/v1/analyses", files=files or [("file", PDF)], **kwargs)


# ── 접수 ──────────────────────────────────────────────────────────────


def test_accepts_immediately_with_202_and_job_id(member, db_sessionmaker):
    client, user_id = member

    response = _post(client)

    assert response.status_code == 202, "분석이 끝날 때까지 기다리면 안 된다"
    body = response.json()
    assert body["success"] is True
    assert body["data"]["status"] == JobStatus.QUEUED
    # 안내 Modal 이 뜨므로 토스트까지 띄우면 같은 말이 두 번 나온다.
    assert body["message"] == ""

    with db_sessionmaker() as db:
        job = db.execute(select(AnalysisJob)).scalar_one()
        assert job.id == uuid.UUID(body["data"]["id"])
        assert job.user_id == user_id
        assert job.status == JobStatus.QUEUED
        assert job.file_names == ["contract.pdf"]


def test_files_are_spooled_before_the_job_becomes_visible(member, db_sessionmaker):
    """워커가 파일 없는 QUEUED 를 집어가면 안 된다."""
    client, _ = member

    job_id = uuid.UUID(_post(client).json()["data"]["id"])

    assert (spool.spool_dir(job_id) / "000").read_bytes() == b"fake-pdf"


def test_creates_started_notification_pointing_at_the_job(member, db_sessionmaker):
    client, user_id = member

    job_id = uuid.UUID(_post(client).json()["data"]["id"])

    with db_sessionmaker() as db:
        note = db.execute(select(Notification)).scalar_one()
        assert note.type == NotificationType.ANALYSIS_STARTED
        assert note.resource_type == "ANALYSIS_JOB"
        assert note.resource_id == job_id
        assert note.read_at is None


# ── 중복 방지 ─────────────────────────────────────────────────────────


def test_second_request_while_running_is_rejected(member, db_sessionmaker):
    client, _ = member
    _post(client)

    response = _post(client)

    assert response.status_code == 409
    assert response.json()["error"]["title"] == "분석이 이미 진행 중입니다"
    with db_sessionmaker() as db:
        assert len(db.execute(select(AnalysisJob)).scalars().all()) == 1


def test_same_idempotency_key_returns_the_original_job(member, db_sessionmaker):
    """더블클릭·네트워크 재시도가 분석을 두 번 돌리면 안 된다."""
    client, _ = member
    headers = {"Idempotency-Key": "req-1"}

    first = _post(client, headers=headers)
    second = _post(client, headers=headers)

    assert first.json()["data"]["id"] == second.json()["data"]["id"]
    with db_sessionmaker() as db:
        assert len(db.execute(select(AnalysisJob)).scalars().all()) == 1


# ── 입력 검증 (알림이 아니라 즉시 응답으로 알린다) ──────────────────────


def test_rejects_more_files_than_the_limit(member):
    client, _ = member
    files = [
        ("file", (f"document-{i}.pdf", b"pdf", "application/pdf"))
        for i in range(settings.CONTRACT_MAX_FILES + 1)
    ]

    response = _post(client, files=files)

    assert response.status_code == 413
    assert response.json()["error"]["title"] == "파일 개수 초과"


def test_rejects_unsupported_extension(member):
    client, _ = member

    response = _post(client, files=[("file", ("contract.hwp", b"x", "application/octet-stream"))])

    assert response.status_code == 415


def test_rejects_empty_file(member):
    client, _ = member

    response = _post(client, files=[("file", ("contract.pdf", b"", "application/pdf"))])

    assert response.status_code == 422


def test_rejects_oversized_file(member):
    client, _ = member
    too_big = b"x" * (settings.CONTRACT_MAX_FILE_MB * 1024 * 1024 + 1)

    response = _post(client, files=[("file", ("contract.pdf", too_big, "application/pdf"))])

    assert response.status_code == 413


def test_invalid_input_leaves_no_job_and_no_spool(member, db_sessionmaker):
    client, _ = member

    _post(client, files=[("file", ("contract.hwp", b"x", "application/octet-stream"))])

    with db_sessionmaker() as db:
        assert db.execute(select(AnalysisJob)).scalars().all() == []
    assert not spool.SPOOL_ROOT.exists() or not any(spool.SPOOL_ROOT.iterdir())


# ── 조회·소유권 ───────────────────────────────────────────────────────


def test_detail_returns_progress_while_running(member):
    client, _ = member
    job_id = _post(client).json()["data"]["id"]

    body = client.get(f"/api/v1/analyses/{job_id}").json()["data"]

    assert body["status"] == JobStatus.QUEUED
    assert body["result"] is None
    assert body["error"] is None


def test_detail_returns_result_when_succeeded(member, db_sessionmaker):
    client, user_id = member
    job_id = uuid.UUID(_post(client).json()["data"]["id"])
    payload = {
        "sanitized_text": "본문",
        "redaction_counts": {},
        "redaction_scope": [],
        "mask_count": 0,
        "coarse_mask_count": 0,
        "review_required": False,
        "documents": [],
        "analysis": {"summary": "요약", "terms": {}, "risks": [], "missing_information": []},
    }
    with db_sessionmaker() as db:
        job = db.execute(select(AnalysisJob)).scalar_one()
        job.status = JobStatus.SUCCEEDED.value
        db.add(
            AnalysisResult(
                job_id=job.id,
                user_id=user_id,
                title="아파트",
                summary="요약",
                risk_level="HIGH",
                payload=payload,
            )
        )
        db.commit()

    body = client.get(f"/api/v1/analyses/{job_id}").json()["data"]

    assert body["title"] == "아파트"
    assert body["risk_level"] == "HIGH"
    assert body["result"]["analysis"]["summary"] == "요약"


def test_detail_returns_user_facing_error_when_failed(member, db_sessionmaker):
    client, _ = member
    job_id = _post(client).json()["data"]["id"]
    with db_sessionmaker() as db:
        job = db.execute(select(AnalysisJob)).scalar_one()
        job.status = JobStatus.FAILED.value
        job.error_code = "503"
        job.error_message = "잠시 후 다시 시도해 주세요."
        db.commit()

    body = client.get(f"/api/v1/analyses/{job_id}").json()["data"]

    assert body["error"] == {"code": "503", "message": "잠시 후 다시 시도해 주세요."}


def test_other_users_job_is_404_not_403(member, db_sessionmaker, register_member):
    """403 이면 "그 id 는 존재한다" 를 알려주는 셈이다."""
    client, _ = member
    job_id = _post(client).json()["data"]["id"]

    stranger = register_member()
    app.dependency_overrides[require_user] = lambda: {"sub": str(stranger)}

    assert client.get(f"/api/v1/analyses/{job_id}").status_code == 404


def test_malformed_job_id_is_404(member):
    client, _ = member
    assert client.get("/api/v1/analyses/not-a-uuid").status_code == 404


def test_list_returns_newest_first_with_summary_columns(member, db_sessionmaker):
    client, user_id = member
    with db_sessionmaker() as db:
        for index in range(3):
            job = AnalysisJob(
                user_id=user_id,
                status=JobStatus.SUCCEEDED.value,
                file_names=[f"{index}.pdf"],
            )
            db.add(job)
            db.flush()
            db.add(
                AnalysisResult(
                    job_id=job.id,
                    user_id=user_id,
                    title=f"제목{index}",
                    risk_level="LOW",
                    payload={},
                )
            )
        db.commit()

    body = client.get("/api/v1/analyses?limit=2").json()["data"]

    assert len(body["items"]) == 2
    assert body["next_cursor"] is not None
    assert all(item["title"].startswith("제목") for item in body["items"])
    assert all(item["risk_level"] == "LOW" for item in body["items"])


def test_list_excludes_other_users_jobs(member, db_sessionmaker, register_member):
    client, _ = member
    _post(client)
    stranger = register_member()
    app.dependency_overrides[require_user] = lambda: {"sub": str(stranger)}

    assert client.get("/api/v1/analyses").json()["data"]["items"] == []


def test_unregistered_user_cannot_start_analysis(client):
    """analysis_job.user_id 는 app_user 를 FK 로 참조한다 — 가입 완료가 전제다."""
    app.dependency_overrides[require_user] = lambda: {"sub": str(uuid.uuid4())}

    assert _post(client).status_code == 403
