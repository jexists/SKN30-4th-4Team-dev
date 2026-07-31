"""RunPod Queue-based Serverless 진입점.

입력 파일은 private Supabase Storage의 짧은 signed URL로만 받는다. URL과 OCR 원문은
어떤 로그에도 기록하지 않는다.
"""

import logging
import tempfile
import time
from base64 import b64encode
from functools import lru_cache
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from app.core.config import settings
from app.errors import OcrProcessingError, PiiRemainsError
from app.inference.paddle_vl_engine import PaddleVlEngine
from app.inference.tesseract_engine import TesseractEngine
from app.masking.patterns import PiiType
from app.pipeline.contract_pipeline import ContractProcessingPipeline
from app.schemas import AnalysisReadyResponse

logger = logging.getLogger(__name__)

_ALLOWED_CONTENT_TYPES = {
    "application/pdf": ".pdf",
    "image/png": ".png",
    "image/jpeg": ".jpg",
}
_processing_lock = Lock()


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise OcrProcessingError("UNSUPPORTED_FORMAT")


@lru_cache(maxsize=1)
def _pipeline() -> ContractProcessingPipeline:
    engine = (
        TesseractEngine(settings)
        if settings.OCR_PROVIDER == "tesseract"
        else PaddleVlEngine(settings)
    )
    return ContractProcessingPipeline(engine, settings)


def _validate_source_url(source_url: object) -> str:
    if not isinstance(source_url, str):
        raise OcrProcessingError("UNSUPPORTED_FORMAT")
    parsed = urlsplit(source_url)
    allowed_host = settings.OCR_SOURCE_ALLOWED_HOST.strip().lower().rstrip(".")
    hostname = (parsed.hostname or "").lower().rstrip(".")
    try:
        port = parsed.port
    except ValueError as exc:
        raise OcrProcessingError("UNSUPPORTED_FORMAT") from exc
    if (
        parsed.scheme != "https"
        or not allowed_host
        or hostname != allowed_host
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.fragment
    ):
        raise OcrProcessingError("UNSUPPORTED_FORMAT")
    return source_url


def _download(source_url: str, destination: Path) -> int:
    max_bytes = settings.OCR_MAX_FILE_MB * 1024 * 1024
    request = Request(source_url, headers={"User-Agent": "homeshield-ocr-worker/1.0"})
    try:
        with build_opener(_NoRedirect).open(
            request, timeout=settings.OCR_SOURCE_DOWNLOAD_TIMEOUT_SECONDS
        ) as response:
            content_length = response.headers.get("Content-Length")
            if content_length is not None and int(content_length) > max_bytes:
                raise OcrProcessingError("FILE_TOO_LARGE", http_status=413)
            total = 0
            with destination.open("wb") as target:
                while chunk := response.read(64 * 1024):
                    total += len(chunk)
                    if total > max_bytes:
                        raise OcrProcessingError("FILE_TOO_LARGE", http_status=413)
                    target.write(chunk)
            return total
    except OcrProcessingError:
        raise
    except (HTTPError, URLError, TimeoutError, ValueError) as exc:
        raise OcrProcessingError("OCR_INTERNAL_ERROR", http_status=503) from exc


def _success_response(input_path: Path, work_dir: Path) -> dict[str, object]:
    output_path = work_dir / "masked.pdf"
    with _processing_lock:
        result = _pipeline().process(input_path, work_dir, output_path)
    return AnalysisReadyResponse(
        sanitized_text=result.sanitized_text,
        redaction_counts=result.redaction_counts,
        redaction_scope=sorted(pii_type.value for pii_type in PiiType),
        text_safe_for_analysis=result.text_safe_for_analysis,
        mask_count=result.mask_count,
        coarse_mask_count=result.coarse_mask_count,
        review_required=result.review_required,
        masked_pdf_base64=b64encode(output_path.read_bytes()).decode("ascii"),
    ).model_dump()


def handler(job: dict[str, object]) -> dict[str, object]:
    started = time.perf_counter()
    runpod_job_id = job.get("id") if isinstance(job.get("id"), str) else "unknown"
    size = 0
    content_type = "unknown"
    error_code: str | None = None
    try:
        payload = job.get("input")
        if not isinstance(payload, dict):
            raise OcrProcessingError("UNSUPPORTED_FORMAT")
        content_type = str(payload.get("content_type", ""))
        suffix = _ALLOWED_CONTENT_TYPES.get(content_type)
        if suffix is None:
            raise OcrProcessingError("UNSUPPORTED_FORMAT", http_status=415)
        filename = payload.get("filename")
        if not isinstance(filename, str) or Path(filename).suffix.lower() not in {
            suffix,
            ".jpeg" if suffix == ".jpg" else suffix,
        }:
            raise OcrProcessingError("UNSUPPORTED_FORMAT", http_status=415)
        source_url = _validate_source_url(payload.get("source_url"))
        with tempfile.TemporaryDirectory(prefix="contract-ocr-") as temp_dir:
            work_dir = Path(temp_dir)
            input_path = work_dir / f"input{suffix}"
            size = _download(source_url, input_path)
            output = _success_response(input_path, work_dir)
        logger.info(
            "Serverless OCR completed runpod_job_id=%s mime=%s size=%d elapsed=%.1fs",
            runpod_job_id,
            content_type,
            size,
            time.perf_counter() - started,
        )
        return output
    except PiiRemainsError:
        error_code = "PII_REMAINS"
    except OcrProcessingError as exc:
        error_code = exc.code
    except ValueError:
        error_code = "OCR_RESULT_INVALID"
    except OSError:
        error_code = "INVALID_IMAGE"
    except Exception:
        error_code = "OCR_INTERNAL_ERROR"

    logger.warning(
        "Serverless OCR failed runpod_job_id=%s error_code=%s mime=%s size=%d elapsed=%.1fs",
        runpod_job_id,
        error_code,
        content_type,
        size,
        time.perf_counter() - started,
    )
    return {"error": {"code": error_code}}


if __name__ == "__main__":
    import runpod

    runpod.serverless.start({"handler": handler})
