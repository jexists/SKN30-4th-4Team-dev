import io
from urllib.error import HTTPError

import pytest

from app.core.config import settings
from app.core.exceptions import AppError
from app.services.document_processing import client as client_module
from app.services.document_processing.client import OcrWorkerClient


def _raise_http_error(monkeypatch, status: int, body: bytes = b"") -> None:
    """process_for_analysis 가 워커에게서 HTTP status 를 받은 상황을 만든다."""

    def fake_urlopen(request, timeout=None):  # noqa: ARG001
        raise HTTPError(
            "https://worker.example/v1/process-for-analysis",
            status,
            "err",
            {},  # type: ignore[arg-type]
            io.BytesIO(body),
        )

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)


def test_ocr_worker_client_adds_api_key_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "runpod-secret")

    assert OcrWorkerClient._base_headers()["X-API-Key"] == "runpod-secret"


def test_ocr_worker_client_omits_empty_api_key(monkeypatch):
    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "")

    assert "X-API-Key" not in OcrWorkerClient._base_headers()


def test_ocr_worker_client_always_sends_user_agent(monkeypatch):
    """User-Agent 는 키 유무와 무관하게 항상 붙어야 한다.

    Worker 를 외부 GPU 호스팅에 두면 앞단 Cloudflare 가 urllib 기본 UA 를 봇으로 보고
    403(error 1010)으로 막는다. 이 헤더가 빠지면 워커가 살아 있는데도 백엔드는 503 을 낸다.
    """
    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "")
    assert OcrWorkerClient._base_headers()["User-Agent"].startswith("Mozilla/5.0")

    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "runpod-secret")
    assert OcrWorkerClient._base_headers()["User-Agent"].startswith("Mozilla/5.0")


@pytest.mark.parametrize("status", [413, 415, 422])
def test_document_rejection_stays_422(monkeypatch, status):
    """워커가 문서를 거부한 것만 사용자 파일 문제(422)로 올린다 — 재시도해도 결과가 같다."""
    _raise_http_error(monkeypatch, status, '{"detail":"PDF는 최대 20페이지까지"}'.encode())

    with pytest.raises(AppError) as caught:
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert caught.value.code == 422


@pytest.mark.parametrize("status", [401, 403, 404, 429])
def test_infrastructure_4xx_becomes_retryable_503(monkeypatch, status):
    """문서와 무관한 4xx 는 503 이어야 한다.

    RunPod pod 이 내려가면 프록시가 **404** 를, Cloudflare 는 403 을, 키가 틀리면 워커가 401 을
    준다. 예전엔 이 셋이 전부 422 "파일 상태를 확인해 주세요" 로 나가서 (1) 서버 장애를 사용자
    파일 탓으로 돌리고 (2) 422 가 재시도 대상이 아니라 분석이 몇 초 만에 즉시 실패로 닫혔다.
    """
    _raise_http_error(monkeypatch, status)

    with pytest.raises(AppError) as caught:
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert caught.value.code == 503
    # 사용자에게 파일을 의심하라고 말하지 않는다.
    assert "파일" not in caught.value.message
