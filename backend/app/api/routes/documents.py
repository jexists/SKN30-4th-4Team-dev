from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, File, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.deps import RequireUser
from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.common import ApiResponse, success_response
from app.schemas.document import (
    AnalyzeDocumentsResponse,
    FileAnalysisResult,
    FileAnalysisStatus,
    OcrWorkerHealth,
)
from app.services.document_processing.client import OcrWorkerClient
from app.services.document_processing.mapper import map_to_risk_engine

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png"}
ALLOWED_SUFFIXES = {".pdf", ".jpg", ".jpeg", ".png"}


async def _read_upload(upload: UploadFile) -> tuple[str, bytes, str]:
    file_name = Path(upload.filename or "document").name
    content_type = upload.content_type or "application/octet-stream"
    if (
        Path(file_name).suffix.lower() not in ALLOWED_SUFFIXES
        or content_type not in ALLOWED_CONTENT_TYPES
    ):
        raise AppError(
            "지원하지 않는 파일",
            "PDF, JPG 또는 PNG 파일만 업로드할 수 있습니다.",
            415,
        )

    max_bytes = settings.OCR_MAX_FILE_MB * 1024 * 1024
    content = await upload.read(max_bytes + 1)
    if not content:
        raise AppError("빈 파일", "내용이 있는 문서를 업로드해 주세요.", 422)
    if len(content) > max_bytes:
        raise AppError(
            "파일 용량 초과",
            f"파일 하나당 {settings.OCR_MAX_FILE_MB}MB까지 업로드할 수 있습니다.",
            413,
        )
    return file_name, content, content_type


@router.get("/ocr-health", response_model=ApiResponse[OcrWorkerHealth])
def ocr_health() -> ApiResponse[OcrWorkerHealth]:
    """백엔드와 로컬 OCR worker 사이의 연결 상태를 확인한다."""
    return success_response(OcrWorkerClient().health())


@router.post("/analyze", response_model=ApiResponse[AnalyzeDocumentsResponse])
async def analyze_documents(
    user: RequireUser,
    contract_file: Annotated[UploadFile, File()],
    registry_file: Annotated[UploadFile | None, File()] = None,
) -> ApiResponse[AnalyzeDocumentsResponse]:
    """계약 서류 묶음을 구조화하고, 선택한 등기부등본의 OCR 원문을 함께 반환한다."""
    del user
    client = OcrWorkerClient()
    contract_name, contract_content, contract_type = await _read_upload(contract_file)
    contract_data = await run_in_threadpool(
        client.extract,
        file_name=contract_name,
        content=contract_content,
        content_type=contract_type,
        mode="contract_bundle",
    )
    try:
        engine_input = map_to_risk_engine(contract_data)
    except ValueError as exc:
        raise AppError("계약서 확인 필요", str(exc), 422) from exc

    registry_result: FileAnalysisResult | None = None
    if registry_file is not None:
        registry_name, registry_content, registry_type = await _read_upload(registry_file)
        try:
            registry_data = await run_in_threadpool(
                client.extract,
                file_name=registry_name,
                content=registry_content,
                content_type=registry_type,
                mode="registry",
            )
            registry_result = FileAnalysisResult(
                status=FileAnalysisStatus.COMPLETED,
                data=registry_data,
            )
        except AppError as exc:
            registry_result = FileAnalysisResult(
                status=FileAnalysisStatus.FAILED,
                error=exc.message,
            )

    result = AnalyzeDocumentsResponse(
        contract=FileAnalysisResult(
            status=FileAnalysisStatus.COMPLETED,
            data=contract_data,
        ),
        registry=registry_result,
        engine_input=engine_input,
    )
    return success_response(result, message="문서 분석이 완료되었습니다.")
