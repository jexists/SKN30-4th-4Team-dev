import base64

from app.api.deps import require_user
from app.main import app
from app.schemas.document import (
    ContractLlmAnalysis,
    ContractTerms,
    OcrAnalysisResult,
    OcrWorkerHealth,
)
from app.services.document_processing.analyzer import ContractAnalyzer
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


def test_analyze_document_sends_only_sanitized_text_to_llm(client, monkeypatch):
    sanitized = "[페이지 1]\n임차인: [이름]\n보증금: 금 일억원정"
    monkeypatch.setattr(
        OcrWorkerClient,
        "process_for_analysis",
        lambda self, filename, content: OcrAnalysisResult(
            sanitized_text=sanitized,
            redaction_counts={"name": 1},
            redaction_scope=["name"],
            text_safe_for_analysis=True,
            mask_count=1,
            coarse_mask_count=1,
            review_required=True,
            masked_pdf_media_type="application/pdf",
            masked_pdf_base64=base64.b64encode(b"%PDF-fake").decode(),
        ),
    )
    received: list[str] = []

    def fake_analyze(self, text):
        received.append(text)
        return ContractLlmAnalysis(
            summary="보증금 1억원의 임대차계약입니다.",
            terms=ContractTerms(deposit="금 일억원정"),
        )

    monkeypatch.setattr(ContractAnalyzer, "analyze", fake_analyze)
    app.dependency_overrides[require_user] = lambda: {"sub": "user-id"}

    response = client.post(
        "/api/v1/documents/analyze",
        files={"file": ("contract.pdf", b"fake-pdf", "application/pdf")},
    )

    assert response.status_code == 200
    assert received == [sanitized]
    assert "홍길동" not in received[0]
    assert response.json()["data"]["analysis"]["terms"]["deposit"] == "금 일억원정"
    assert response.json()["data"]["review_required"] is True


def test_analyze_document_stops_before_llm_when_text_is_unsafe(client, monkeypatch):
    monkeypatch.setattr(
        OcrWorkerClient,
        "process_for_analysis",
        lambda self, filename, content: OcrAnalysisResult(
            sanitized_text="연락처 010-1234-5678",
            redaction_counts={},
            redaction_scope=[],
            text_safe_for_analysis=False,
            mask_count=0,
            coarse_mask_count=0,
            review_required=True,
            masked_pdf_media_type="application/pdf",
            masked_pdf_base64=base64.b64encode(b"%PDF-fake").decode(),
        ),
    )
    called = False

    def fake_analyze(self, text):
        nonlocal called
        called = True

    monkeypatch.setattr(ContractAnalyzer, "analyze", fake_analyze)
    app.dependency_overrides[require_user] = lambda: {"sub": "user-id"}

    response = client.post(
        "/api/v1/documents/analyze",
        files={"file": ("contract.pdf", b"fake-pdf", "application/pdf")},
    )

    assert response.status_code == 422
    assert called is False
