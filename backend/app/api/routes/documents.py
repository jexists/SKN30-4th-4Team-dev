"""OCR worker 상태 확인.

서류 분석 접수는 routes/analysis.py(`/api/v1/analyses`)로 옮겼다 — 분석이 동기 요청이
아니라 작업 큐에 올리는 일이 되면서 "문서를 분석한다" 가 아니라 "분석 작업 리소스" 가 됐다.
"""

from fastapi import APIRouter

from app.schemas.common import ApiResponse, success_response
from app.schemas.document import OcrWorkerHealth
from app.services.document_processing.client import OcrWorkerClient

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/ocr-health", response_model=ApiResponse[OcrWorkerHealth])
def ocr_health() -> ApiResponse[OcrWorkerHealth]:
    """백엔드와 로컬 OCR worker 사이의 연결 상태를 확인한다."""
    return success_response(OcrWorkerClient().health())
