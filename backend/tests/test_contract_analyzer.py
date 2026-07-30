import pytest

from app.schemas.document import ContractLlmAnalysis, ContractTerms
from app.services.document_processing.analyzer import (
    ContractAnalyzer,
    _contract_type_from_rent,
)


class FakeStructuredModel:
    def __init__(self):
        self.messages = []

    def invoke(self, messages):
        self.messages = messages
        return ContractLlmAnalysis(
            summary="보증금 1억원의 임대차계약입니다.",
            terms=ContractTerms(deposit="1억원"),
        )


class FakeChatModel:
    def __init__(self, structured):
        self.structured = structured
        self.schema = None

    def with_structured_output(self, schema):
        self.schema = schema
        return self.structured


def test_analyzer_uses_sanitized_text_and_structured_schema():
    structured = FakeStructuredModel()
    model = FakeChatModel(structured)

    result = ContractAnalyzer(model).analyze("임차인: [이름]\n주소: [주소]\n보증금: 1억원")

    assert model.schema is ContractLlmAnalysis
    assert structured.messages[1][1].endswith("임차인: [이름]\n주소: [주소]\n보증금: 1억원")
    assert result.terms.deposit == "1억원"


def test_local_contract_analysis_extracts_terms_and_risks():
    text = """[페이지 1]
주택 유형: 아파트
소재지: 서울특별시 강남구 테헤란로 123
보증금: 금 일억원정
월세: 금 오십만원정
계약 기간: 2026년 8월 1일 ~ 2028년 7월 31일
특약: 임차인은 모든 수리 비용을 부담한다.
등기부에 근저당 설정 여부를 확인한다.
"""

    result = ContractAnalyzer._analyze_locally(text)

    assert isinstance(result, ContractLlmAnalysis)
    assert result.terms.property_type == "아파트"
    assert result.terms.address == "서울특별시 강남구 테헤란로 123"
    assert result.terms.deposit == "금 일억원정"
    assert result.terms.monthly_rent == "금 오십만원정"
    assert result.terms.contract_start == "2026년 8월 1일"
    assert result.terms.contract_end == "2028년 7월 31일"
    # 금액이 한글로만 적혀 있어도 월세로 잡아야 한다 — 숫자 유무로 판단하지 않는 이유.
    assert result.terms.contract_type == "월세"
    assert {risk.severity for risk in result.risks} >= {"HIGH", "MEDIUM"}


def test_local_contract_analysis_reads_jeonse_when_rent_row_is_blank():
    """전세 계약서는 차임 칸이 비어 있거나 '없음' 이다."""
    text = """[페이지 1]
주택 유형: 오피스텔
보증금: 금 삼억원정
월세: 없음
계약 기간: 2026년 8월 1일 ~ 2028년 7월 31일
"""

    result = ContractAnalyzer._analyze_locally(text)

    assert result.terms.contract_type == "전세"
    assert result.terms.property_type == "오피스텔"


@pytest.mark.parametrize(
    ("monthly_rent", "expected"),
    [
        (None, "전세"),
        ("", "전세"),
        ("   ", "전세"),
        ("없음", "전세"),
        ("해당 없음", "전세"),
        ("무", "전세"),
        ("-", "전세"),
        ("0원", "전세"),
        ("금 오십만원정", "월세"),
        ("70만원", "월세"),
        ("700,000원", "월세"),
    ],
)
def test_contract_type_from_rent(monthly_rent, expected):
    assert _contract_type_from_rent(monthly_rent) == expected
