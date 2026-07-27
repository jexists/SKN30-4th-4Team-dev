from pydantic import BaseModel


class AnalysisReadyResponse(BaseModel):
    sanitized_text: str
    redaction_counts: dict[str, int]
    redaction_scope: list[str]
    text_safe_for_analysis: bool
    mask_count: int
    coarse_mask_count: int
    review_required: bool
    masked_pdf_media_type: str = "application/pdf"
    masked_pdf_base64: str
