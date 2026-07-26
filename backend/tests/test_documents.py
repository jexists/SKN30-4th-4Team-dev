from app.schemas.document import OcrWorkerHealth
from app.services.document_processing.client import OcrWorkerClient


def test_ocr_health_returns_standard_envelope(client, monkeypatch):
    monkeypatch.setattr(
        OcrWorkerClient,
        "health",
        lambda self: OcrWorkerHealth(
            status="ok",
            model="PaddlePaddle/PaddleOCR-VL-1.6",
            model_loaded=False,
        ),
    )

    response = client.get("/api/v1/documents/ocr-health")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["model"] == "PaddlePaddle/PaddleOCR-VL-1.6"
    assert body["data"]["model_loaded"] is False
