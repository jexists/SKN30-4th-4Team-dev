import base64
import json
import logging
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import OcrAnalysisResult, OcrWorkerHealth

logger = logging.getLogger(__name__)


class OcrWorkerClient:
    """내부 OCR worker의 상태 확인과 계약서 처리 API를 호출한다."""

    @staticmethod
    def _auth_headers() -> dict[str, str]:
        if not settings.OCR_WORKER_API_KEY:
            return {}
        return {"X-API-Key": settings.OCR_WORKER_API_KEY}

    def health(self) -> OcrWorkerHealth:
        url = f"{settings.OCR_WORKER_URL.rstrip('/')}/health"
        request = Request(url, headers=self._auth_headers())
        try:
            with urlopen(  # noqa: S310
                request, timeout=settings.OCR_WORKER_TIMEOUT_SECONDS
            ) as response:
                payload = json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise AppError(
                "OCR_WORKER_UNAVAILABLE",
                "OCR 처리 서버에 연결할 수 없습니다.",
                503,
            ) from exc
        return OcrWorkerHealth.model_validate(payload)

    def process_for_analysis(self, filename: str, content: bytes) -> OcrAnalysisResult:
        """파일을 내부 Worker로 보내고 개인정보 치환 텍스트와 PDF를 받는다."""
        url = f"{settings.OCR_WORKER_URL.rstrip('/')}/v1/process-for-analysis"
        boundary = f"----skn30-{uuid.uuid4().hex}"
        suffix = Path(filename).suffix.lower()
        safe_filename = f"contract{suffix}" if suffix else "contract.pdf"
        safe_content_type = {
            ".pdf": "application/pdf",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
        }.get(suffix, "application/octet-stream")
        body = (
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{safe_filename}"\r\n'
                f"Content-Type: {safe_content_type}\r\n\r\n"
            ).encode()
            + content
            + f"\r\n--{boundary}--\r\n".encode()
        )
        request = Request(  # noqa: S310 - URL은 서버 설정의 내부 Worker 주소로 고정한다.
            url,
            data=body,
            method="POST",
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                **self._auth_headers(),
            },
        )
        try:
            with urlopen(  # noqa: S310
                request, timeout=settings.OCR_WORKER_PROCESS_TIMEOUT_SECONDS
            ) as response:
                payload = json.loads(response.read())
            result = OcrAnalysisResult.model_validate(payload)
            base64.b64decode(result.masked_pdf_base64, validate=True)
            return result
        except HTTPError as exc:
            logger.warning("OCR Worker 처리 거부: status=%s", exc.code)
            raise AppError(
                "계약서 처리 실패",
                "계약서를 OCR 처리하지 못했습니다. 파일 상태를 확인해 주세요.",
                422 if 400 <= exc.code < 500 else 503,
            ) from exc
        except (URLError, TimeoutError) as exc:
            raise AppError(
                "OCR 서버 연결 실패",
                "계약서 처리 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
                503,
            ) from exc
        except (json.JSONDecodeError, ValueError) as exc:
            logger.exception("OCR Worker 응답 검증 실패")
            raise AppError(
                "계약서 처리 실패",
                "OCR 처리 결과를 확인하지 못했습니다.",
                502,
            ) from exc
