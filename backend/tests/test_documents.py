from app.api.deps import require_user
from app.core.exceptions import AppError
from app.schemas.document import OcrExtractionResponse, OcrWorkerHealth
from app.services.document_processing.client import OcrWorkerClient


def _extraction(mode: str = "contract_bundle") -> OcrExtractionResponse:
    documents = []
    if mode == "contract_bundle":
        documents = [
            {
                "doc_type": "lease_contract",
                "source_file": "contract.pdf",
                "page_count": 1,
                "parsed_at": "2026-07-26T12:00:00+09:00",
                "parser_version": "1.0.0",
                "overall_confidence": 0.96,
                "warnings": [],
                "fields": {
                    "address": {"value": "서울시 강서구", "status": "extracted"},
                    "deposit": {"value": 250000000, "status": "extracted"},
                },
            }
        ]
    return OcrExtractionResponse.model_validate(
        {
            "mode": mode,
            "source_file": "contract.pdf" if mode == "contract_bundle" else "registry.pdf",
            "page_count": 1,
            "mask_count": 2,
            "coarse_mask_count": 0,
            "review_required": False,
            "ocr_pages": [
                {
                    "page": 1,
                    "width": 1000,
                    "height": 1400,
                    "text": "임대차계약서 보증금 250,000,000원",
                    "method": "text",
                }
            ],
            "documents": documents,
            "missing_doc_types": [],
            "warnings": [],
        }
    )


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


def test_analyze_maps_contract_and_returns_registry_failure(client, monkeypatch):
    client.app.dependency_overrides[require_user] = lambda: {"sub": "test-user"}

    def extract(self, *, mode, **kwargs):
        if mode == "registry":
            raise AppError("문서 처리 실패", "등기부등본을 읽지 못했습니다.", 422)
        return _extraction(mode)

    monkeypatch.setattr(OcrWorkerClient, "extract", extract)

    response = client.post(
        "/api/v1/documents/analyze",
        files={
            "contract_file": ("contract.pdf", b"contract", "application/pdf"),
            "registry_file": ("registry.pdf", b"registry", "application/pdf"),
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["contract"]["status"] == "completed"
    assert body["data"]["registry"] == {
        "status": "failed",
        "data": None,
        "error": "등기부등본을 읽지 못했습니다.",
    }
    assert body["data"]["engine_input"]["contract"]["deposit"] == 250000000
    assert "building_name" in body["data"]["engine_input"]["unknowns"]


def test_analyze_rejects_unsupported_contract_file(client):
    client.app.dependency_overrides[require_user] = lambda: {"sub": "test-user"}

    response = client.post(
        "/api/v1/documents/analyze",
        files={"contract_file": ("contract.txt", b"plain", "text/plain")},
    )

    assert response.status_code == 415
    assert response.json()["error"]["title"] == "지원하지 않는 파일"
