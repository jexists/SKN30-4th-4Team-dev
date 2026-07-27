from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.api.deps import RequireUser
from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.common import ApiResponse, success_response
from app.schemas.document import DocumentAnalysisOut, OcrWorkerHealth
from app.services.document_processing.analyzer import ContractAnalyzer
from app.services.document_processing.client import OcrWorkerClient

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/ocr-health", response_model=ApiResponse[OcrWorkerHealth])
def ocr_health() -> ApiResponse[OcrWorkerHealth]:
    """백엔드와 로컬 OCR worker 사이의 연결 상태를 확인한다."""
    return success_response(OcrWorkerClient().health())


@router.post("/analyze", response_model=ApiResponse[DocumentAnalysisOut])
def analyze_document(
    file: Annotated[UploadFile, File()], _user: RequireUser
) -> ApiResponse[DocumentAnalysisOut]:
    """계약서를 로컬 OCR로 익명화한 뒤 안전 텍스트만 LLM에 전달한다."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise AppError(
            "지원하지 않는 파일",
            "PDF, PNG, JPG 계약서만 업로드할 수 있습니다.",
            415,
        )
    max_bytes = settings.CONTRACT_MAX_FILE_MB * 1024 * 1024
    content = file.file.read(max_bytes + 1)
    if not content:
        raise AppError("빈 파일", "내용이 없는 계약서는 분석할 수 없습니다.", 422)
    if len(content) > max_bytes:
        raise AppError(
            "파일 크기 초과",
            f"계약서는 최대 {settings.CONTRACT_MAX_FILE_MB}MB까지 업로드할 수 있습니다.",
            413,
        )

    ocr_result = OcrWorkerClient().process_for_analysis(
        file.filename or f"contract{suffix}",
        content,
    )
    if not ocr_result.text_safe_for_analysis:
        raise AppError(
            "개인정보 검토 필요",
            "계약서에서 개인정보가 남아 있어 자동 분석을 중단했습니다.",
            422,
        )

    analysis = ContractAnalyzer().analyze(ocr_result.sanitized_text)
    return success_response(
        DocumentAnalysisOut(
            sanitized_text=ocr_result.sanitized_text,
            redaction_counts=ocr_result.redaction_counts,
            redaction_scope=ocr_result.redaction_scope,
            mask_count=ocr_result.mask_count,
            coarse_mask_count=ocr_result.coarse_mask_count,
            review_required=ocr_result.review_required,
            masked_pdf_media_type=ocr_result.masked_pdf_media_type,
            masked_pdf_base64=ocr_result.masked_pdf_base64,
            analysis=analysis,
        ),
        message="계약서 분석을 완료했습니다.",
    )
