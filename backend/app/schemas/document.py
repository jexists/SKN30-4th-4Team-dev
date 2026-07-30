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
    deposit: str | None = None
    monthly_rent: str | None = None
    contract_start: str | None = None
    contract_end: str | None = None
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
