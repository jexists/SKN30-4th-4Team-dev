import base64
import logging

import httpx
import pytest

from app.core.config import settings
from app.core.exceptions import AppError
from app.services.document_processing import client as client_module
from app.services.document_processing.client import OcrWorkerClient


def _result() -> dict[str, object]:
    return {
        "sanitized_text": "안전한 내용",
        "redaction_counts": {"name": 1},
        "redaction_scope": ["name"],
        "text_safe_for_analysis": True,
        "mask_count": 1,
        "coarse_mask_count": 0,
        "review_required": False,
        "masked_pdf_media_type": "application/pdf",
        "masked_pdf_base64": base64.b64encode(b"%PDF-test").decode(),
    }


@pytest.fixture(autouse=True)
def runpod_settings(monkeypatch):
    monkeypatch.setattr(settings, "OCR_TRANSPORT", "runpod_serverless")
    monkeypatch.setattr(settings, "RUNPOD_ENDPOINT_ID", "endpoint-1")
    monkeypatch.setattr(settings, "RUNPOD_API_KEY", "secret-runpod-key")
    monkeypatch.setattr(settings, "RUNPOD_STATUS_POLL_SECONDS", 0.001)
    monkeypatch.setattr(settings, "RUNPOD_JOB_TTL_MS", 3_600_000)
    monkeypatch.setattr(client_module.time, "sleep", lambda _seconds: None)


def _response(status: int, payload: dict[str, object], request: httpx.Request) -> httpx.Response:
    return httpx.Response(status, json=payload, request=request)


def test_submit_saves_id_then_polls_to_completion(monkeypatch):
    states = iter(
        [
            (200, {"id": "rp-job-1", "status": "IN_QUEUE"}),
            (200, {"id": "rp-job-1", "status": "IN_QUEUE"}),
            (200, {"id": "rp-job-1", "status": "IN_PROGRESS"}),
            (200, {"id": "rp-job-1", "status": "COMPLETED", "output": _result()}),
        ]
    )
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        status, payload = next(states)
        return _response(status, payload, httpx.Request(method, url))

    monkeypatch.setattr(client_module.httpx, "request", fake_request)
    submitted = []
    statuses = []
    result = OcrWorkerClient().process_for_analysis(
        "secret-contract.png",
        source_url_factory=lambda: "https://project.supabase.co/signed?token=secret",
        on_submitted=lambda job_id, status: submitted.append((job_id, status)),
        on_status=statuses.append,
    )

    assert result.sanitized_text == "안전한 내용"
    assert submitted == [("rp-job-1", "IN_QUEUE")]
    assert statuses == ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]
    assert calls[0][0] == "POST"
    assert calls[0][2]["json"]["policy"] == {
        "executionTimeout": settings.RUNPOD_EXECUTION_TIMEOUT_MS,
        "ttl": settings.RUNPOD_JOB_TTL_MS,
    }


def test_existing_job_resumes_status_without_resubmitting(monkeypatch):
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url))
        return _response(
            200,
            {"id": "existing", "status": "COMPLETED", "output": _result()},
            httpx.Request(method, url),
        )

    monkeypatch.setattr(client_module.httpx, "request", fake_request)
    OcrWorkerClient().process_for_analysis(
        "contract.pdf",
        source_url_factory=lambda: pytest.fail("기존 작업에 새 signed URL을 만들면 안 됨"),
        external_job_id="existing",
    )

    assert [method for method, _ in calls] == ["GET"]


@pytest.mark.parametrize(
    ("runpod_status", "expected_code"),
    [("FAILED", 503), ("TIMED_OUT", 504), ("CANCELLED", 503)],
)
def test_terminal_statuses_are_classified(monkeypatch, runpod_status, expected_code):
    def fake_request(method, url, **kwargs):
        return _response(
            200,
            {"id": "existing", "status": runpod_status},
            httpx.Request(method, url),
        )

    monkeypatch.setattr(client_module.httpx, "request", fake_request)
    with pytest.raises(AppError) as caught:
        OcrWorkerClient().process_for_analysis(
            "contract.pdf", source_url_factory=lambda: "unused", external_job_id="existing"
        )
    assert caught.value.code == expected_code
    assert runpod_status in caught.value.title


def test_429_and_5xx_retry_without_second_submission(monkeypatch):
    states = iter(
        [
            (429, {}),
            (503, {}),
            (200, {"id": "rp-job-2", "status": "IN_QUEUE"}),
            (503, {}),
            (200, {"id": "rp-job-2", "status": "COMPLETED", "output": _result()}),
        ]
    )
    methods = []

    def fake_request(method, url, **kwargs):
        methods.append(method)
        status, payload = next(states)
        return _response(status, payload, httpx.Request(method, url))

    monkeypatch.setattr(client_module.httpx, "request", fake_request)
    submitted = []
    OcrWorkerClient().process_for_analysis(
        "contract.pdf",
        source_url_factory=lambda: "https://project.supabase.co/signed",
        on_submitted=lambda job_id, status: submitted.append(job_id),
    )

    assert methods == ["POST", "POST", "POST", "GET", "GET"]
    assert submitted == ["rp-job-2"]


def test_logs_do_not_include_secrets_or_worker_output(monkeypatch, caplog):
    signed_url = "https://project.supabase.co/private?token=signed-secret"
    ocr_text = "주민등록번호 000000-0000000"

    def fake_request(method, url, **kwargs):
        return _response(
            200,
            {
                "id": "rp-job-3",
                "status": "COMPLETED",
                "output": {"error": {"code": "OCR_INTERNAL_ERROR", "detail": ocr_text}},
            },
            httpx.Request(method, url),
        )

    monkeypatch.setattr(client_module.httpx, "request", fake_request)
    with caplog.at_level(logging.INFO), pytest.raises(AppError):
        OcrWorkerClient().process_for_analysis(
            "private-name.pdf", source_url_factory=lambda: signed_url
        )

    logs = caplog.text
    assert settings.RUNPOD_API_KEY not in logs
    assert signed_url not in logs
    assert ocr_text not in logs
    assert "private-name" not in logs
