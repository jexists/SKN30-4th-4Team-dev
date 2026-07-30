import base64

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.pipeline.contract_pipeline import ContractProcessingPipeline, ProcessingResult


def test_worker_api_key_is_required_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "runpod-secret")
    client = TestClient(app)

    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"X-API-Key": "wrong"}).status_code == 401
    assert (
        client.get("/health", headers={"X-API-Key": "runpod-secret"}).status_code
        == 200
    )


def test_analysis_endpoint_returns_sanitized_text_and_masked_pdf(monkeypatch):
    def fake_process(self, input_path, work_dir, output_path):
        output_path.write_bytes(b"%PDF-masked")
        return ProcessingResult(
            output_path=output_path,
            mask_count=2,
            coarse_mask_count=2,
            review_required=True,
            sanitized_text="임차인: [이름]\n전화번호: [전화번호]",
            redaction_counts={"name": 1, "phone_number": 1},
            text_safe_for_analysis=True,
        )

    monkeypatch.setattr(ContractProcessingPipeline, "process", fake_process)

    response = TestClient(app).post(
        "/v1/process-for-analysis",
        files={"file": ("contract.png", b"fake-image", "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert "[이름]" in body["sanitized_text"]
    assert "name" in body["redaction_scope"]
    assert base64.b64decode(body["masked_pdf_base64"]) == b"%PDF-masked"


def test_existing_pdf_endpoint_remains_compatible(monkeypatch):
    def fake_process(self, input_path, work_dir, output_path):
        output_path.write_bytes(b"%PDF-masked")
        return ProcessingResult(
            output_path=output_path,
            mask_count=1,
            coarse_mask_count=1,
            review_required=True,
            sanitized_text="전화번호: [전화번호]",
            redaction_counts={"phone_number": 1},
            text_safe_for_analysis=True,
        )

    monkeypatch.setattr(ContractProcessingPipeline, "process", fake_process)

    response = TestClient(app).post(
        "/v1/process",
        files={"file": ("contract.png", b"fake-image", "image/png")},
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == b"%PDF-masked"
