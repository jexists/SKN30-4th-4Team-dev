"""Supabase Storage 응답을 분석 작업 오류로 변환하는 규칙."""

import uuid

import httpx
import pytest

from app.core.config import settings
from app.core.exceptions import AppError
from app.services.analysis_jobs import storage


@pytest.fixture(autouse=True)
def _storage_settings(monkeypatch):
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://project.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key")
    monkeypatch.setattr(settings, "ANALYSIS_UPLOAD_BUCKET", "analysis-uploads")


def _response(status: int, payload: dict) -> httpx.Response:
    request = httpx.Request("GET", "https://project.supabase.co/storage/v1/object/test")
    return httpx.Response(status, json=payload, request=request)


def test_supabase_400_no_such_key_is_terminal_missing_file(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: _response(
            400,
            {
                "statusCode": "404",
                "error": "not_found",
                "message": "Object not found",
                "code": "NoSuchKey",
            },
        ),
    )

    with pytest.raises(AppError) as caught:
        storage.download_job_file(uuid.uuid4(), uuid.uuid4(), 0, "contract.pdf")

    assert caught.value.code == 422


def test_other_storage_400_remains_retryable_service_error(monkeypatch):
    monkeypatch.setattr(
        httpx,
        "get",
        lambda *args, **kwargs: _response(400, {"message": "different bad request"}),
    )

    with pytest.raises(AppError) as caught:
        storage.download_job_file(uuid.uuid4(), uuid.uuid4(), 0, "contract.pdf")

    assert caught.value.code == 503
