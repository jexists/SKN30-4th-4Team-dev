from app.core.config import settings
from app.services.document_processing.client import OcrWorkerClient


def test_ocr_worker_client_adds_api_key_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "runpod-secret")

    assert OcrWorkerClient._auth_headers() == {"X-API-Key": "runpod-secret"}


def test_ocr_worker_client_omits_empty_api_key(monkeypatch):
    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "")

    assert OcrWorkerClient._auth_headers() == {}
