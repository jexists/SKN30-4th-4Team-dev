import logging
import tempfile
from pathlib import Path
from threading import Lock
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from app.core.config import settings
from app.extraction.builder import build_extraction_response
from app.extraction.schemas import ExtractionMode, ExtractionResponse
from app.inference.paddle_vl_engine import PaddleVlEngine
from app.pipeline.contract_pipeline import ContractProcessingPipeline

logger = logging.getLogger(__name__)
app = FastAPI(title="Contract OCR/Masking Worker")
engine = PaddleVlEngine(settings)
processing_lock = Lock()
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg"}


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "model": settings.OCR_MODEL_NAME,
        "model_loaded": engine.is_loaded,
    }


def _read_upload(file: UploadFile) -> tuple[str, bytes]:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(415, "PDF, PNG, JPG 파일만 처리할 수 있습니다.")

    content = file.file.read(settings.OCR_MAX_FILE_MB * 1024 * 1024 + 1)
    if not content:
        raise HTTPException(422, "빈 파일은 처리할 수 없습니다.")
    if len(content) > settings.OCR_MAX_FILE_MB * 1024 * 1024:
        raise HTTPException(413, f"파일은 최대 {settings.OCR_MAX_FILE_MB}MB까지 허용됩니다.")
    return suffix, content


@app.post("/v1/process", response_class=Response)
def process_document(file: Annotated[UploadFile, File()]) -> Response:
    suffix, content = _read_upload(file)

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
    except (ValueError, OSError) as exc:
        logger.warning("Document processing rejected: %s", type(exc).__name__)
        raise HTTPException(422, "문서를 처리하거나 검증하지 못했습니다.") from exc
    except Exception as exc:
        # OCR 원문이나 파일 내용이 로그/응답에 노출되지 않게 예외 타입만 남긴다.
        logger.exception("Document processing failed: %s", type(exc).__name__)
        raise HTTPException(500, "OCR 처리 중 오류가 발생했습니다.") from exc

    return Response(
        body,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'attachment; filename="masked.pdf"',
            "X-Mask-Count": str(result.mask_count),
            "X-Coarse-Mask-Count": str(result.coarse_mask_count),
            "X-Review-Required": str(result.review_required).lower(),
        },
    )


@app.post("/v1/extract", response_model=ExtractionResponse)
def extract_document(
    file: Annotated[UploadFile, File()],
    mode: Annotated[ExtractionMode, Form()] = ExtractionMode.CONTRACT_BUNDLE,
) -> ExtractionResponse:
    suffix, content = _read_upload(file)

    try:
        with tempfile.TemporaryDirectory(prefix="contract-extract-") as temp_dir:
            work_dir = Path(temp_dir)
            input_path = work_dir / f"input{suffix}"
            output_path = work_dir / "masked.pdf"
            input_path.write_bytes(content)
            with processing_lock:
                result = ContractProcessingPipeline(engine, settings).process(
                    input_path, work_dir, output_path
                )
            return build_extraction_response(
                result,
                source_file=Path(file.filename or f"document{suffix}").name,
                mode=mode,
            )
    except (ValueError, OSError) as exc:
        logger.warning("Document extraction rejected: %s", type(exc).__name__)
        raise HTTPException(422, "문서를 OCR 추출하거나 분류하지 못했습니다.") from exc
    except Exception as exc:
        logger.exception("Document extraction failed: %s", type(exc).__name__)
        raise HTTPException(500, "OCR 추출 중 오류가 발생했습니다.") from exc
