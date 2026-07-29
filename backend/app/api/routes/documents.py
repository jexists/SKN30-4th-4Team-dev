from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile

from app.api.deps import RequireUser
from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.common import ApiResponse, success_response
from app.schemas.document import (
    DocumentAnalysisOut,
    DocumentOcrOut,
    OcrAnalysisResult,
    OcrWorkerHealth,
)
from app.services.document_processing.analyzer import ContractAnalyzer
from app.services.document_processing.client import OcrWorkerClient

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/ocr-health", response_model=ApiResponse[OcrWorkerHealth])
def ocr_health() -> ApiResponse[OcrWorkerHealth]:
    """백엔드와 로컬 OCR worker 사이의 연결 상태를 확인한다."""
    return success_response(OcrWorkerClient().health())


@router.post("/analyze", response_model=ApiResponse[DocumentAnalysisOut])
def analyze_document(
    file: Annotated[list[UploadFile], File()], _user: RequireUser
) -> ApiResponse[DocumentAnalysisOut]:
    """모든 제출 서류를 OCR로 익명화한 뒤 안전 텍스트를 종합 분석한다."""
    if len(file) > settings.CONTRACT_MAX_FILES:
        raise AppError(
            "파일 개수 초과",
            f"서류는 최대 {settings.CONTRACT_MAX_FILES}개까지 업로드할 수 있습니다.",
            413,
        )

    max_bytes = settings.CONTRACT_MAX_FILE_MB * 1024 * 1024
    worker = OcrWorkerClient()
    processed: list[tuple[str, OcrAnalysisResult]] = []
    for index, upload in enumerate(file, start=1):
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
            raise AppError(
                "지원하지 않는 파일",
                "모든 서류는 PDF, PNG, JPG 형식이어야 합니다.",
                415,
            )

        content = upload.file.read(max_bytes + 1)
        if not content:
            raise AppError("빈 파일", f"{index}번째 서류에 내용이 없습니다.", 422)
        if len(content) > max_bytes:
            raise AppError(
                "파일 크기 초과",
                f"각 서류는 최대 {settings.CONTRACT_MAX_FILE_MB}MB까지 업로드할 수 있습니다.",
                413,
            )

        filename = Path(upload.filename or f"document-{index}{suffix}").name
        result = worker.process_for_analysis(filename, content)
        if not result.text_safe_for_analysis:
            raise AppError(
                "개인정보 검토 필요",
                f"{index}번째 서류에서 개인정보가 남아 있어 종합 분석을 중단했습니다.",
                422,
            )
        if len(result.sanitized_text) > settings.CONTRACT_ANALYSIS_MAX_CHARS:
            raise AppError(
                "서류 분석 실패",
                f"{index}번째 서류의 인식 내용이 분석 가능한 길이를 초과했습니다.",
                422,
            )
        processed.append((filename, result))

    combined_text = (
        processed[0][1].sanitized_text
        if len(processed) == 1
        else "\n\n".join(
            f"[문서 {index}]\n{result.sanitized_text.strip()}"
            for index, (_, result) in enumerate(processed, start=1)
        )
    )
    analysis = ContractAnalyzer().analyze(combined_text)
    first_result = processed[0][1]
    redaction_counts: dict[str, int] = {}
    for _, result in processed:
        for pii_type, count in result.redaction_counts.items():
            redaction_counts[pii_type] = redaction_counts.get(pii_type, 0) + count

    return success_response(
        DocumentAnalysisOut(
            sanitized_text=combined_text,
            redaction_counts=redaction_counts,
            redaction_scope=sorted(
                {pii_type for _, result in processed for pii_type in result.redaction_scope}
            ),
            mask_count=sum(result.mask_count for _, result in processed),
            coarse_mask_count=sum(result.coarse_mask_count for _, result in processed),
            review_required=any(result.review_required for _, result in processed),
            # 기존 단일 파일 클라이언트 호환 필드. 전체 결과는 documents에 제공한다.
            masked_pdf_media_type=first_result.masked_pdf_media_type,
            masked_pdf_base64=first_result.masked_pdf_base64,
            documents=[
                DocumentOcrOut(
                    filename=filename,
                    **result.model_dump(exclude={"text_safe_for_analysis"}),
                )
                for filename, result in processed
            ],
            analysis=analysis,
        ),
        message=f"서류 {len(processed)}개의 종합 분석을 완료했습니다.",
    )
