import base64

from app.api.deps import require_user
from app.core.config import settings
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


def test_analyze_document_processes_all_files_and_combines_results(client, monkeypatch):
    ocr_calls: list[tuple[str, bytes]] = []

    def fake_process(self, filename, content):
        ocr_calls.append((filename, content))
        index = len(ocr_calls)
        return OcrAnalysisResult(
            sanitized_text=f"서류 {index}의 안전한 내용",
            redaction_counts={"name": index},
            redaction_scope=["name", "address"] if index == 2 else ["name"],
            text_safe_for_analysis=True,
            mask_count=index,
            coarse_mask_count=1,
            review_required=index == 2,
            masked_pdf_media_type="application/pdf",
            masked_pdf_base64=base64.b64encode(f"%PDF-{index}".encode()).decode(),
        )

    monkeypatch.setattr(OcrWorkerClient, "process_for_analysis", fake_process)
    analyzed: list[str] = []

    def fake_analyze(self, text):
        analyzed.append(text)
        return ContractLlmAnalysis(
            summary="두 서류를 종합 분석했습니다.",
            terms=ContractTerms(),
        )

    monkeypatch.setattr(ContractAnalyzer, "analyze", fake_analyze)
    app.dependency_overrides[require_user] = lambda: {"sub": "user-id"}

    response = client.post(
        "/api/v1/documents/analyze",
        files=[
            ("file", ("register.pdf", b"register", "application/pdf")),
            ("file", ("contract.jpg", b"contract", "image/jpeg")),
        ],
    )

    assert response.status_code == 200
    assert ocr_calls == [("register.pdf", b"register"), ("contract.jpg", b"contract")]
    assert analyzed == ["[문서 1]\n서류 1의 안전한 내용\n\n[문서 2]\n서류 2의 안전한 내용"]
    data = response.json()["data"]
    assert data["redaction_counts"] == {"name": 3}
    assert data["redaction_scope"] == ["address", "name"]
    assert data["mask_count"] == 3
    assert data["coarse_mask_count"] == 2
    assert data["review_required"] is True
    assert [item["filename"] for item in data["documents"]] == [
        "register.pdf",
        "contract.jpg",
    ]


def test_analyze_document_rejects_more_files_than_the_limit(client):
    app.dependency_overrides[require_user] = lambda: {"sub": "user-id"}

    response = client.post(
        "/api/v1/documents/analyze",
        files=[
            ("file", (f"document-{index}.pdf", b"pdf", "application/pdf"))
            for index in range(settings.CONTRACT_MAX_FILES + 1)
        ],
    )

    assert response.status_code == 413
    assert response.json()["error"]["title"] == "파일 개수 초과"
