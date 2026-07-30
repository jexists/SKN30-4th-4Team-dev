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
    contract_type: Literal["전세", "월세"] | None = None
    deposit: str | None = None
    monthly_rent: str | None = None
    contract_start: str | None = None
    contract_end: str | None = None
    address: str | None = None
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
