from dataclasses import replace
from pathlib import Path

from app.extraction.builder import build_extraction_response
from app.extraction.schemas import (
    DocumentType,
    ExtractionMethod,
    ExtractionMode,
    FieldStatus,
    LeaseContractDocument,
)
from app.extraction.types import RecognizedPage
from app.inference.types import ParsedPage, TextRegion
from app.pipeline.contract_pipeline import ProcessingResult


def _page(index: int, text: str) -> RecognizedPage:
    return RecognizedPage(
        parsed=ParsedPage(
            page_index=index,
            width=1200,
            height=1600,
            regions=[
                TextRegion(
                    page_index=index,
                    text=text,
                    bbox=(10, 10, 1100, 1500),
                    block_order=0,
                )
            ],
        ),
        method=ExtractionMethod.OCR,
    )


def _processing_result() -> ProcessingResult:
    return ProcessingResult(
        output_path=Path("masked.pdf"),
        mask_count=3,
        coarse_mask_count=3,
        review_required=True,
        recognized_pages=[
            _page(
                0,
                """부동산 임대차계약서
소재지: 서울특별시 강서구 화곡동 000-0
건물명: OO빌라
호수: 제202호
전용면적: 13.4평
임대인: 김 임 대
임대인 생년월일: 1970. 1. 1.
임차인: 박 임 차
보증금: 금 이억오천만원정 (₩250,000,000)
월세: 0원
관리비: 70,000원
계약금: 25,000,000원
잔금: 225,000,000원
잔금 지급일: 2026. 8. 30.
계약일: 2026. 7. 20.
임대차 기간: 2026. 8. 30.부터 2028. 8. 29.까지
인도일: 2026. 8. 30.
중개사무소: 화곡공인중개사사무소
등록번호: 11500 - 2021 - 00123
중개보수: 1,000,000원
예금주: 김 임 대
은행: 국민은행
계좌번호: 000-00-000000
특약사항
1. 임대인은 잔금일 익일까지 근저당 등 권리 설정을 하지 않는다.""",
            ),
            _page(
                1,
                """중개대상물 확인·설명서
소재지: 서울특별시 강서구 화곡동 000-0
호수: 제202호
면적: 44.2㎡
임대인: 김임대
보증금: 250,000,000원
등기상 권리: 근저당권 60,000,000원 OO은행 2021. 3. 2.
실제 권리관계:
관리비: 70,000원
포함 항목: 수도, 인터넷
벽·바닥: 양호
급수: 정상
난방: 개별난방 · 정상
중개보수: 1,000,000원
요율: 0.4%
등록번호: 11500-2021-00123
작성일: 2026. 7. 20.""",
            ),
            _page(
                2,
                """공제증서
발급기관: 한국공인중개사협회
보장금액: 200,000,000원
유효기간: 2026. 1. 1.부터 2026. 12. 31.까지
중개사무소: 화곡공인중개사사무소
등록번호: 11500-2021-00123
대표자: 이 중 개
증서번호: 제2026-000000호""",
            ),
        ],
    )


def test_builds_four_contract_documents_and_preserves_provenance():
    response = build_extraction_response(
        _processing_result(),
        source_file="contract.pdf",
        mode=ExtractionMode.CONTRACT_BUNDLE,
    )

    assert response.mask_count == 3
    assert response.missing_doc_types == []
    assert {document.doc_type for document in response.documents} == set(DocumentType)

    lease = next(
        document
        for document in response.documents
        if isinstance(document, LeaseContractDocument)
    )
    assert lease.fields.deposit.value == 250_000_000
    assert lease.fields.deposit_hangul.value == 250_000_000
    assert lease.fields.deposit.page == 1
    assert lease.fields.unit_no.value == "202"
    assert lease.fields.area_m2.value == 44.3

    disclosure = next(
        document
        for document in response.documents
        if document.doc_type is DocumentType.DISCLOSURE
    )
    assert disclosure.fields.actual_rights.section_status is FieldStatus.NOT_STATED


def test_registry_mode_returns_raw_ocr_without_structured_documents():
    response = build_extraction_response(
        _processing_result(),
        source_file="registry.pdf",
        mode=ExtractionMode.REGISTRY,
    )

    assert response.documents == []
    assert response.ocr_pages[0].text.startswith("부동산 임대차계약서")


def test_unreadable_structured_fields_require_review():
    processing = replace(
        _processing_result(),
        review_required=False,
        coarse_mask_count=0,
    )

    response = build_extraction_response(
        processing,
        source_file="contract.pdf",
        mode=ExtractionMode.CONTRACT_BUNDLE,
    )

    assert response.review_required is True
