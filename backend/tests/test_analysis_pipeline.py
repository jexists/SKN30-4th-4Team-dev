"""분석 파이프라인 — OCR 합치기·개인정보 잔존 차단·길이 상한.

원래 test_documents.py 가 동기 엔드포인트를 통해 검증하던 것들이다. 로직이 HTTP 에서
분리되면서 파이프라인 함수를 직접 태운다.
"""

import base64

import pytest

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import (
    ContractLlmAnalysis,
    ContractTerms,
    OcrAnalysisResult,
)
from app.services.analysis_jobs import pipeline
from app.services.document_processing.analyzer import ContractAnalyzer
from app.services.document_processing.client import OcrWorkerClient


def _ocr(text: str, *, safe: bool = True, index: int = 1) -> OcrAnalysisResult:
    return OcrAnalysisResult(
        sanitized_text=text,
        redaction_counts={"name": index},
        redaction_scope=["name", "address"] if index == 2 else ["name"],
        text_safe_for_analysis=safe,
        mask_count=index,
        coarse_mask_count=1,
        review_required=index == 2,
        masked_pdf_media_type="application/pdf",
        masked_pdf_base64=base64.b64encode(b"%PDF-fake").decode(),
    )


@pytest.fixture()
def spool(tmp_path):
    def _make(count: int):
        for index in range(count):
            (tmp_path / f"{index:03d}").write_bytes(f"pdf-{index}".encode())
        return tmp_path

    return _make


def test_only_sanitized_text_reaches_the_llm(spool, monkeypatch):
    sanitized = "[페이지 1]\n임차인: [이름]\n보증금: 금 일억원정"
    monkeypatch.setattr(
        OcrWorkerClient, "process_for_analysis", lambda self, filename, content: _ocr(sanitized)
    )
    received: list[str] = []

    def fake_analyze(self, text):
        received.append(text)
        return ContractLlmAnalysis(
            summary="보증금 1억원의 임대차계약입니다.",
            terms=ContractTerms(deposit="금 일억원정"),
        )

    monkeypatch.setattr(ContractAnalyzer, "analyze", fake_analyze)

    result = pipeline.run_analysis(spool(1), ["contract.pdf"])

    assert received == [sanitized]
    assert "홍길동" not in received[0]
    assert result.analysis.terms.deposit == "금 일억원정"


def test_masked_pdf_never_reaches_the_stored_result(spool, monkeypatch):
    """마스킹 PDF 는 보관하지 않기로 했다 — 결과에 새어 들어가면 DB 가 수십 MB 로 부푼다."""
    monkeypatch.setattr(
        OcrWorkerClient, "process_for_analysis", lambda self, filename, content: _ocr("본문")
    )
    monkeypatch.setattr(
        ContractAnalyzer,
        "analyze",
        lambda self, text: ContractLlmAnalysis(summary="요약", terms=ContractTerms()),
    )

    dumped = pipeline.run_analysis(spool(1), ["contract.pdf"]).model_dump()

    assert "masked_pdf_base64" not in str(dumped)


def test_stops_before_llm_when_pii_remains(spool, monkeypatch):
    monkeypatch.setattr(
        OcrWorkerClient,
        "process_for_analysis",
        lambda self, filename, content: _ocr("연락처 010-1234-5678", safe=False),
    )
    called = False

    def fake_analyze(self, text):
        nonlocal called
        called = True

    monkeypatch.setattr(ContractAnalyzer, "analyze", fake_analyze)

    with pytest.raises(AppError) as caught:
        pipeline.run_analysis(spool(1), ["contract.pdf"])

    assert caught.value.code == 422
    assert called is False, "개인정보가 남았는데 LLM 을 호출했다"


def test_combines_every_document_in_upload_order(spool, monkeypatch):
    calls: list[tuple[str, bytes]] = []

    def fake_process(self, filename, content):
        calls.append((filename, content))
        return _ocr(f"서류 {len(calls)}의 안전한 내용", index=len(calls))

    monkeypatch.setattr(OcrWorkerClient, "process_for_analysis", fake_process)
    analyzed: list[str] = []

    def fake_analyze(self, text):
        analyzed.append(text)
        return ContractLlmAnalysis(summary="두 서류를 종합했습니다.", terms=ContractTerms())

    monkeypatch.setattr(ContractAnalyzer, "analyze", fake_analyze)

    result = pipeline.run_analysis(spool(2), ["register.pdf", "contract.jpg"])

    assert calls == [("register.pdf", b"pdf-0"), ("contract.jpg", b"pdf-1")]
    assert analyzed == ["[문서 1]\n서류 1의 안전한 내용\n\n[문서 2]\n서류 2의 안전한 내용"]
    assert result.redaction_counts == {"name": 3}
    assert result.redaction_scope == ["address", "name"]
    assert result.mask_count == 3
    assert result.coarse_mask_count == 2
    assert result.review_required is True
    assert [doc.filename for doc in result.documents] == ["register.pdf", "contract.jpg"]


def test_rejects_document_longer_than_the_per_file_limit(spool, monkeypatch):
    monkeypatch.setattr(
        OcrWorkerClient,
        "process_for_analysis",
        lambda self, filename, content: _ocr("가" * (settings.CONTRACT_ANALYSIS_MAX_CHARS + 1)),
    )

    with pytest.raises(AppError) as caught:
        pipeline.run_analysis(spool(1), ["contract.pdf"])
    assert caught.value.code == 422


def test_rejects_when_combined_text_exceeds_the_total_limit(spool, monkeypatch):
    chunk = "가" * settings.CONTRACT_ANALYSIS_MAX_CHARS
    monkeypatch.setattr(
        OcrWorkerClient, "process_for_analysis", lambda self, filename, content: _ocr(chunk)
    )
    called = False

    def fake_analyze(self, text):
        nonlocal called
        called = True

    monkeypatch.setattr(ContractAnalyzer, "analyze", fake_analyze)

    count = settings.CONTRACT_ANALYSIS_MAX_TOTAL_CHARS // settings.CONTRACT_ANALYSIS_MAX_CHARS + 1
    with pytest.raises(AppError) as caught:
        pipeline.run_analysis(spool(count), [f"doc-{i}.pdf" for i in range(count)])

    assert caught.value.code == 422
    assert called is False


def test_missing_spool_is_a_terminal_error(tmp_path, monkeypatch):
    """스풀이 사라졌다 = 프로세스가 바뀌었다. 재시도해도 살아나지 않으므로 4xx 여야 한다."""
    with pytest.raises(AppError) as caught:
        pipeline.run_analysis(tmp_path, ["contract.pdf"])
    assert caught.value.code == 422


def test_summarize_picks_the_worst_severity(spool):
    from app.schemas.analysis import AnalysisResultOut
    from app.schemas.document import ContractRiskIssue

    def build(*severities):
        return AnalysisResultOut(
            sanitized_text="",
            redaction_counts={},
            redaction_scope=[],
            mask_count=0,
            coarse_mask_count=0,
            review_required=False,
            analysis=ContractLlmAnalysis(
                summary="요약",
                terms=ContractTerms(property_type="아파트"),
                risks=[
                    ContractRiskIssue(severity=s, title="t", reason="r", recommendation="c")
                    for s in severities
                ],
            ),
        )

    assert pipeline.summarize(build("LOW", "HIGH", "MEDIUM"), ["a.pdf"])[2] == "HIGH"
    assert pipeline.summarize(build("LOW", "MEDIUM"), ["a.pdf"])[2] == "MEDIUM"
    assert pipeline.summarize(build("LOW"), ["a.pdf"])[2] == "LOW"
    assert pipeline.summarize(build(), ["a.pdf"])[2] == "LOW"


def test_summarize_falls_back_to_first_filename_without_property_type(spool):
    from app.schemas.analysis import AnalysisResultOut

    result = AnalysisResultOut(
        sanitized_text="",
        redaction_counts={},
        redaction_scope=[],
        mask_count=0,
        coarse_mask_count=0,
        review_required=False,
        analysis=ContractLlmAnalysis(summary="요약", terms=ContractTerms()),
    )
    assert pipeline.summarize(result, ["등기부등본.pdf"])[0] == "등기부등본.pdf"
