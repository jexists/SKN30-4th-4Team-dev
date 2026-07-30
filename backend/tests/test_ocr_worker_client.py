from app.core.config import settings
from app.services.document_processing.client import OcrWorkerClient


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
