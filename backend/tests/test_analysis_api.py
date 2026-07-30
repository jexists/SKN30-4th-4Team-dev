"""분석 접수 API — 202·중복 방지·소유권·입력 검증."""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.api.deps import require_user
from app.core.config import settings
from app.main import app
from app.models.analysis_job import AnalysisJob, AnalysisResult, JobStatus
from app.models.notification import Notification, NotificationType
from app.services.analysis_jobs import storage as analysis_storage

PDF = ("contract.pdf", b"fake-pdf", "application/pdf")


@pytest.fixture(autouse=True)
def stored_uploads(monkeypatch):
    """Supabase 대신 테스트별 메모리 Storage를 사용한다."""
    objects: dict[str, bytes] = {}

    def upload(user_id, job_id, payloads):
        for index, (filename, content) in enumerate(payloads):
            objects[analysis_storage.object_path(user_id, job_id, index, filename)] = content

    def discard(user_id, job_id, file_names):
        for index, filename in enumerate(file_names):
            objects.pop(analysis_storage.object_path(user_id, job_id, index, filename), None)

    monkeypatch.setattr(analysis_storage, "upload_job_files", upload)
    monkeypatch.setattr(analysis_storage, "discard_job", discard)
    return objects


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


def test_files_are_stored_before_the_job_becomes_visible(member, db_sessionmaker, stored_uploads):
    """다른 호스트의 워커가 파일 없는 QUEUED를 집어가면 안 된다."""
    client, user_id = member

    job_id = uuid.UUID(_post(client).json()["data"]["id"])

    path = analysis_storage.object_path(user_id, job_id, 0, "contract.pdf")
    assert stored_uploads[path] == b"fake-pdf"


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


def test_invalid_input_leaves_no_job_and_no_storage_object(member, db_sessionmaker, stored_uploads):
    client, _ = member

    _post(client, files=[("file", ("contract.hwp", b"x", "application/octet-stream"))])

    with db_sessionmaker() as db:
        assert db.execute(select(AnalysisJob)).scalars().all() == []
    assert stored_uploads == {}


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


# ── 제목 수정·삭제 ────────────────────────────────────────────────────


#: 상세 응답이 AnalysisResultOut 으로 검증하므로 최소 필수 필드는 채워 둔다.
_MIN_PAYLOAD = {
    "sanitized_text": "본문",
    "redaction_counts": {},
    "redaction_scope": [],
    "mask_count": 0,
    "coarse_mask_count": 0,
    "review_required": False,
    "documents": [],
    "analysis": {"summary": "요약", "terms": {}, "risks": [], "missing_information": []},
}


def _finish(db_sessionmaker, user_id, *, title="아파트", status=JobStatus.SUCCEEDED):
    """작업 한 건을 결과까지 만들어 둔다 — 수정·삭제 테스트의 출발점."""
    with db_sessionmaker() as db:
        job = db.execute(select(AnalysisJob)).scalar_one()
        job.status = status.value
        db.add(
            AnalysisResult(
                job_id=job.id,
                user_id=user_id,
                title=title,
                risk_level="LOW",
                payload=_MIN_PAYLOAD,
            )
        )
        db.commit()
        return job.id


def test_title_update_is_visible_in_list_and_detail(member, db_sessionmaker):
    client, user_id = member
    job_id = uuid.UUID(_post(client).json()["data"]["id"])
    _finish(db_sessionmaker, user_id)

    body = client.put(f"/api/v1/analyses/{job_id}/title", json={"title": " 강남 원룸 "}).json()

    # 앞뒤 공백은 스키마가 떼고, 토스트 문구는 서버가 소유한다.
    assert body["data"]["title"] == "강남 원룸"
    assert body["message"] == "분석 제목을 수정했습니다."
    assert client.get(f"/api/v1/analyses/{job_id}").json()["data"]["title"] == "강남 원룸"
    assert client.get("/api/v1/analyses").json()["data"]["items"][0]["title"] == "강남 원룸"


def test_title_update_stamps_updated_at(member, db_sessionmaker):
    client, user_id = member
    _post(client)
    job_id = _finish(db_sessionmaker, user_id)
    # 시각을 하루 뒤로 돌려 둔다 — 방금 만든 행과 비교하면 Windows 시계 해상도(~15ms) 안에서
    # 두 값이 같아질 수 있어 테스트가 흔들린다.
    with db_sessionmaker() as db:
        row = db.execute(select(AnalysisResult)).scalar_one()
        row.updated_at = row.created_at - timedelta(days=1)
        db.commit()
        stale = row.updated_at

    client.put(f"/api/v1/analyses/{job_id}/title", json={"title": "새 제목"})

    with db_sessionmaker() as db:
        assert db.execute(select(AnalysisResult)).scalar_one().updated_at > stale


def test_title_update_without_result_is_409(member, db_sessionmaker):
    """실패한 분석에는 제목을 담을 산출물이 없다 — 목록도 그 행엔 수정 메뉴를 띄우지 않는다."""
    client, _ = member
    job_id = _post(client).json()["data"]["id"]
    with db_sessionmaker() as db:
        db.execute(select(AnalysisJob)).scalar_one().status = JobStatus.FAILED.value
        db.commit()

    assert client.put(f"/api/v1/analyses/{job_id}/title", json={"title": "x"}).status_code == 409


def test_blank_title_is_rejected(member, db_sessionmaker):
    client, user_id = member
    _post(client)
    job_id = _finish(db_sessionmaker, user_id)

    assert client.put(f"/api/v1/analyses/{job_id}/title", json={"title": "   "}).status_code == 422


def test_delete_hides_the_job_but_keeps_the_row(member, db_sessionmaker):
    """soft delete — 목록·상세에서 사라지지만 산출물까지 DB 에서 지우지는 않는다."""
    client, user_id = member
    _post(client)
    job_id = _finish(db_sessionmaker, user_id)

    body = client.delete(f"/api/v1/analyses/{job_id}").json()

    assert body["message"] == "분석 기록을 삭제했습니다."
    assert client.get(f"/api/v1/analyses/{job_id}").status_code == 404
    assert client.get("/api/v1/analyses").json()["data"]["items"] == []
    with db_sessionmaker() as db:
        assert db.execute(select(AnalysisJob)).scalar_one().deleted_at is not None
        assert db.execute(select(AnalysisResult)).scalar_one() is not None


def test_deleting_twice_is_404(member, db_sessionmaker):
    client, user_id = member
    _post(client)
    job_id = _finish(db_sessionmaker, user_id)
    client.delete(f"/api/v1/analyses/{job_id}")

    assert client.delete(f"/api/v1/analyses/{job_id}").status_code == 404


def test_running_job_cannot_be_deleted(member, db_sessionmaker):
    """숨겨둔 채로 도는 작업이 있으면 uq_analysis_job_active 때문에 새 분석이 영영 막힌다."""
    client, _ = member
    job_id = _post(client).json()["data"]["id"]

    assert client.delete(f"/api/v1/analyses/{job_id}").status_code == 409
    with db_sessionmaker() as db:
        assert db.execute(select(AnalysisJob)).scalar_one().deleted_at is None


def test_other_users_job_cannot_be_renamed_or_deleted(member, db_sessionmaker, register_member):
    client, user_id = member
    _post(client)
    job_id = _finish(db_sessionmaker, user_id)

    stranger = register_member()
    app.dependency_overrides[require_user] = lambda: {"sub": str(stranger)}

    assert client.put(f"/api/v1/analyses/{job_id}/title", json={"title": "x"}).status_code == 404
    assert client.delete(f"/api/v1/analyses/{job_id}").status_code == 404
