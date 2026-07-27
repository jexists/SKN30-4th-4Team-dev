from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel

from app.schemas.risk_engine import RiskEngineInput


class DocumentStatus(StrEnum):
    UPLOADED = "UPLOADED"
    VALIDATING = "VALIDATING"
    PREPROCESSING = "PREPROCESSING"
    PARSING = "PARSING"
    SPOTTING = "SPOTTING"
    DETECTING_PII = "DETECTING_PII"
    MASKING = "MASKING"
    VERIFYING = "VERIFYING"
    COMPLETED = "COMPLETED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"
    FAILED = "FAILED"
    DELETED = "DELETED"


class OcrWorkerHealth(BaseModel):
    status: str
    model: str
    model_loaded: bool


class DocumentJob(BaseModel):
    document_id: str
    status: DocumentStatus
    current_page: int = 0
    total_pages: int = 0
    review_required: bool = False


class OcrPage(BaseModel):
    page: int
    width: int
    height: int
    text: str
    method: Literal["text", "ocr", "vision"]


class OcrWorkerDocument(BaseModel):
    doc_type: Literal["lease_contract", "special_terms", "disclosure", "mutual_aid"]
    source_file: str
    page_count: int
    parsed_at: datetime
    parser_version: str
    overall_confidence: float
    warnings: list[str]
    fields: dict[str, Any]


class OcrExtractionResponse(BaseModel):
    mode: Literal["contract_bundle", "registry"]
    source_file: str
    page_count: int
    mask_count: int
    coarse_mask_count: int
    review_required: bool
    ocr_pages: list[OcrPage]
    documents: list[OcrWorkerDocument]
    missing_doc_types: list[str]
    warnings: list[str]


class FileAnalysisStatus(StrEnum):
    COMPLETED = "completed"
    FAILED = "failed"


class FileAnalysisResult(BaseModel):
    status: FileAnalysisStatus
    data: OcrExtractionResponse | None = None
    error: str | None = None


class AnalyzeDocumentsResponse(BaseModel):
    contract: FileAnalysisResult
    registry: FileAnalysisResult | None = None
    engine_input: RiskEngineInput
