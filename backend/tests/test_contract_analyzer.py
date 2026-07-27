from app.schemas.document import ContractLlmAnalysis, ContractTerms
from app.services.document_processing.analyzer import ContractAnalyzer


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
