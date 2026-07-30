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


# 분석 접수·처리 테스트는 옮겨졌다:
#   - 접수 API(202·409·중복 방지·소유권)  → tests/test_analysis_api.py
#   - OCR 합치기·개인정보 잔존 차단·길이  → tests/test_analysis_pipeline.py
#   - 큐 선점·재시도·복구                  → tests/test_analysis_worker.py
