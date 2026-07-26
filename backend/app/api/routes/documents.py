from fastapi import APIRouter

from app.schemas.common import ApiResponse, success_response
from app.schemas.document import OcrWorkerHealth
from app.services.document_processing.client import OcrWorkerClient

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/ocr-health", response_model=ApiResponse[OcrWorkerHealth])
def ocr_health() -> ApiResponse[OcrWorkerHealth]:
    """백엔드와 로컬 OCR worker 사이의 연결 상태를 확인한다."""
    return success_response(OcrWorkerClient().health())
