from enum import StrEnum

from pydantic import BaseModel


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
