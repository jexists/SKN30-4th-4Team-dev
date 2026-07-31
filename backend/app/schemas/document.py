"""OCR worker 와 주고받는 계약. 분석 작업·결과 API 스키마는 schemas/analysis.py 에 있다."""

from typing import Literal

from pydantic import BaseModel, Field


class OcrWorkerHealth(BaseModel):
    status: str
    model: str
    model_loaded: bool


class OcrAnalysisResult(BaseModel):
    sanitized_text: str
    redaction_counts: dict[str, int]
    redaction_scope: list[str]
    text_safe_for_analysis: bool
    mask_count: int
    coarse_mask_count: int
    review_required: bool
    masked_pdf_media_type: str
    masked_pdf_base64: str


class ContractTerms(BaseModel):
    # 계약 유형·소재지는 나중에 추가된 필드다. 리포트 전문은 analysis_result.payload
    # JSONB 한 덩어리로 저장되므로 예전 레코드에는 이 키가 아예 없다 —
    # 기본값 None 이 없으면 과거 분석을 다시 열 때 재검증이 터진다.
    # description 은 with_structured_output 이 LLM 에 넘기는 JSON 스키마에 그대로 들어간다.
    # 필드 이름만으로는 무엇을 넣을지 모호해 비워 두는 경우가 있어 명시한다.
    contract_type: Literal["전세", "월세"] | None = Field(
        default=None,
        description="전세 또는 월세. 매월 지급하는 차임이 없거나 0원이면 전세, "
        "차임이 있으면 월세(보증금이 큰 반전세도 월세). 근거가 없으면 비워 둔다.",
    )
    deposit: str | None = None
    monthly_rent: str | None = None
    contract_start: str | None = None
    contract_end: str | None = None
    address: str | None = Field(
        default=None,
        description="임대차 목적물의 소재지. 계약서의 '소재지'·'임차주택의 표시' 에 적힌 "
        "지번 또는 도로명 주소를 그대로 옮긴다. 당사자의 주소가 아니다. "
        "동·호수까지 적혀 있으면 함께 포함한다.",
    )
    property_type: str | None = None
    special_terms: list[str] = Field(default_factory=list)


class ContractRiskIssue(BaseModel):
    severity: Literal["LOW", "MEDIUM", "HIGH"]
    title: str
    clause: str | None = None
    reason: str
    recommendation: str


class ContractLlmAnalysis(BaseModel):
    summary: str
    terms: ContractTerms
    risks: list[ContractRiskIssue] = Field(default_factory=list)
    missing_information: list[str] = Field(default_factory=list)
