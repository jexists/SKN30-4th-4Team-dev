import logging
import secrets
import tempfile
from base64 import b64encode
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from typing import Annotated

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import Response

from app.core.config import settings
from app.errors import OcrProcessingError
from app.inference.paddle_vl_engine import PaddleVlEngine
from app.inference.tesseract_engine import TesseractEngine
from app.masking.patterns import PiiType
from app.pipeline.contract_pipeline import ContractProcessingPipeline, ProcessingResult
from app.schemas import AnalysisReadyResponse

logger = logging.getLogger(__name__)


def require_worker_api_key(x_api_key: Annotated[str | None, Header()] = None) -> None:
    """RunPod 등 공개 배포에서 공유 키가 일치하는 요청만 허용한다."""
    expected = settings.OCR_WORKER_API_KEY
    if not expected:
        return
    if x_api_key is None or not secrets.compare_digest(x_api_key, expected):
        raise HTTPException(401, "유효한 OCR Worker API 키가 필요합니다.")


app = FastAPI(
    title="Contract OCR/Masking Worker",
    dependencies=[Depends(require_worker_api_key)],
)
engine = (
    TesseractEngine(settings) if settings.OCR_PROVIDER == "tesseract" else PaddleVlEngine(settings)
)
processing_lock = Lock()


@dataclass(frozen=True)
class ProcessedDocument:
    pdf: bytes
    result: ProcessingResult


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "model": settings.OCR_MODEL_NAME,
        "provider": settings.OCR_PROVIDER,
        "model_loaded": engine.is_loaded,
    }


def _process_upload(file: UploadFile) -> ProcessedDocument:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".pdf", ".png", ".jpg", ".jpeg"}:
        raise HTTPException(415, {"code": "UNSUPPORTED_FORMAT"})

    content = file.file.read(settings.OCR_MAX_FILE_MB * 1024 * 1024 + 1)
    if len(content) > settings.OCR_MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, {"code": "FILE_TOO_LARGE"})

    try:
        with tempfile.TemporaryDirectory(prefix="contract-ocr-") as temp_dir:
            work_dir = Path(temp_dir)
            input_path = work_dir / f"input{suffix}"
            output_path = work_dir / "masked.pdf"
            input_path.write_bytes(content)
            # 한 프로세스에서 1B 모델 추론을 동시에 실행해 메모리가 중복 사용되지 않게 한다.
            with processing_lock:
                result = ContractProcessingPipeline(engine, settings).process(
                    input_path, work_dir, output_path
                )
            body = output_path.read_bytes()
    except OcrProcessingError as exc:
        logger.warning("Document processing rejected code=%s", exc.code)
        raise HTTPException(exc.http_status, {"code": exc.code}) from exc
    except ValueError as exc:
        logger.warning("Document processing rejected code=OCR_RESULT_INVALID")
        raise HTTPException(422, {"code": "OCR_RESULT_INVALID"}) from exc
    except OSError as exc:
        logger.warning("Document processing rejected code=INVALID_IMAGE")
        raise HTTPException(422, {"code": "INVALID_IMAGE"}) from exc
    except Exception as exc:
        # 예외 메시지에는 OCR 원문이 포함될 수 있으므로 traceback도 남기지 않는다.
        logger.error("Document processing failed code=OCR_INTERNAL_ERROR")
        raise HTTPException(500, {"code": "OCR_INTERNAL_ERROR"}) from exc

    return ProcessedDocument(pdf=body, result=result)


@app.post("/v1/process", response_class=Response)
def process_document(file: Annotated[UploadFile, File()]) -> Response:
    processed = _process_upload(file)
    result = processed.result

    return Response(
        processed.pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="masked.pdf"',
            "X-Mask-Count": str(result.mask_count),
            "X-Coarse-Mask-Count": str(result.coarse_mask_count),
            "X-Review-Required": str(result.review_required).lower(),
        },
    )


@app.post("/v1/process-for-analysis", response_model=AnalysisReadyResponse)
def process_document_for_analysis(
    file: Annotated[UploadFile, File()],
) -> AnalysisReadyResponse:
    """마스킹 PDF와 개인정보 치환 텍스트를 한 번의 OCR 결과로 반환한다."""
    processed = _process_upload(file)
    result = processed.result
    return AnalysisReadyResponse(
        sanitized_text=result.sanitized_text,
        redaction_counts=result.redaction_counts,
        redaction_scope=sorted(pii_type.value for pii_type in PiiType),
        text_safe_for_analysis=result.text_safe_for_analysis,
        mask_count=result.mask_count,
        coarse_mask_count=result.coarse_mask_count,
        review_required=result.review_required,
        masked_pdf_base64=b64encode(processed.pdf).decode("ascii"),
    )
