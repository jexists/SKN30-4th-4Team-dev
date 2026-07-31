import base64
import json
import logging
import random
import time
import uuid
from collections.abc import Callable
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import OcrAnalysisResult, OcrWorkerHealth

logger = logging.getLogger(__name__)

_USER_AGENT = "Mozilla/5.0 (compatible; homeshield-backend/1.0)"
_PENDING = frozenset({"IN_QUEUE", "IN_PROGRESS", "RUNNING"})
_TERMINAL = frozenset({"FAILED", "TIMED_OUT", "CANCELLED"})
_INPUT_ERROR_CODES = frozenset(
    {"INVALID_IMAGE", "UNSUPPORTED_FORMAT", "FILE_TOO_LARGE", "OCR_RESULT_INVALID", "PII_REMAINS"}
)
_TRANSIENT_REQUEST_ATTEMPTS = 5
ExternalJobCallback = Callable[[str, str], None]
StatusCallback = Callable[[str], None]
SignedUrlFactory = Callable[[], str]


class OcrTransportError(AppError):
    """사용자용 HTTP 상태와 운영 진단용 안전 코드를 분리한다."""

    def __init__(self, safe_code: str, title: str, message: str, http_status: int):
        self.safe_code = safe_code
        super().__init__(title, message, http_status)


def _safe_file_metadata(filename: str) -> tuple[str, str]:
    suffix = Path(filename).suffix.lower()
    safe_filename = f"contract{suffix}" if suffix else "contract.pdf"
    content_type = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(suffix, "application/octet-stream")
    return safe_filename, content_type


class DirectHttpTransport:
    """로컬 개발 및 기존 FastAPI Pod용 동기 transport."""

    @staticmethod
    def base_headers() -> dict[str, str]:
        headers = {"User-Agent": _USER_AGENT}
        if settings.OCR_WORKER_API_KEY:
            headers["X-API-Key"] = settings.OCR_WORKER_API_KEY
        return headers

    def health(self) -> OcrWorkerHealth:
        url = f"{settings.OCR_WORKER_URL.rstrip('/')}/health"
        request = Request(url, headers=self.base_headers())
        try:
            with urlopen(request, timeout=settings.OCR_WORKER_TIMEOUT_SECONDS) as response:  # noqa: S310
                payload = json.loads(response.read())
            return OcrWorkerHealth.model_validate(payload)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, ValidationError) as exc:
            logger.warning("OCR Worker 헬스체크 실패 transport=direct")
            raise AppError(
                "OCR Worker 연결 실패", "OCR 처리 서버에 연결할 수 없습니다.", 503
            ) from exc

    def process(self, filename: str, content: bytes) -> OcrAnalysisResult:
        safe_filename, content_type = _safe_file_metadata(filename)
        boundary = f"----skn30-{uuid.uuid4().hex}"
        body = (
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{safe_filename}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode()
            + content
            + f"\r\n--{boundary}--\r\n".encode()
        )
        request = Request(  # noqa: S310
            f"{settings.OCR_WORKER_URL.rstrip('/')}/v1/process-for-analysis",
            data=body,
            method="POST",
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                **self.base_headers(),
            },
        )
        started = time.perf_counter()
        try:
            with urlopen(request, timeout=settings.OCR_WORKER_PROCESS_TIMEOUT_SECONDS) as response:  # noqa: S310
                payload = json.loads(response.read())
            result = OcrAnalysisResult.model_validate(payload)
            base64.b64decode(result.masked_pdf_base64, validate=True)
            logger.info(
                "OCR 완료 transport=direct mime=%s size=%d elapsed=%.1fs",
                content_type,
                len(content),
                time.perf_counter() - started,
            )
            return result
        except HTTPError as exc:
            logger.warning(
                "OCR 실패 transport=direct status=%d mime=%s size=%d elapsed=%.1fs",
                exc.code,
                content_type,
                len(content),
                time.perf_counter() - started,
            )
            raise AppError(
                "계약서 처리 실패",
                "계약서를 OCR 처리하지 못했습니다. 파일 상태를 확인해 주세요.",
                422 if 400 <= exc.code < 500 else 503,
            ) from exc
        except (URLError, TimeoutError) as exc:
            logger.warning(
                "OCR 연결 실패 transport=direct mime=%s size=%d elapsed=%.1fs",
                content_type,
                len(content),
                time.perf_counter() - started,
            )
            raise AppError(
                "OCR 서버 연결 실패",
                "계약서 처리 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
                503,
            ) from exc
        except (json.JSONDecodeError, ValidationError, ValueError) as exc:
            logger.warning(
                "OCR 응답 검증 실패 transport=direct mime=%s size=%d",
                content_type,
                len(content),
            )
            raise AppError("계약서 처리 실패", "OCR 처리 결과를 확인하지 못했습니다.", 502) from exc


class RunpodServerlessTransport:
    """RunPod queue endpoint에 제출하고 짧은 HTTP 요청으로 상태만 폴링한다."""

    def __init__(self) -> None:
        endpoint_id = settings.RUNPOD_ENDPOINT_ID.strip()
        api_key = settings.RUNPOD_API_KEY.strip()
        if not endpoint_id or not api_key:
            raise OcrTransportError(
                "RUNPOD_CONFIG_INVALID",
                "OCR 서버 설정 오류",
                "OCR 처리 서버가 설정되지 않았습니다.",
                503,
            )
        self.base_url = f"https://api.runpod.ai/v2/{endpoint_id}"
        self.headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    def process(
        self,
        filename: str,
        *,
        source_url_factory: SignedUrlFactory,
        external_job_id: str | None,
        on_submitted: ExternalJobCallback | None,
        on_status: StatusCallback | None,
    ) -> OcrAnalysisResult:
        safe_filename, content_type = _safe_file_metadata(filename)
        started = time.monotonic()
        deadline = started + settings.RUNPOD_JOB_TTL_MS / 1000

        job_id = external_job_id
        if job_id is None:
            payload = self._request_json(
                "POST",
                "/run",
                deadline=deadline,
                json_body={
                    "input": {
                        "source_url": source_url_factory(),
                        "filename": safe_filename,
                        "content_type": content_type,
                    },
                    "policy": {
                        "executionTimeout": settings.RUNPOD_EXECUTION_TIMEOUT_MS,
                        "ttl": settings.RUNPOD_JOB_TTL_MS,
                    },
                },
            )
            job_id = payload.get("id")
            status = payload.get("status", "IN_QUEUE")
            if not isinstance(job_id, str) or not job_id:
                raise AppError("OCR 작업 제출 실패", "OCR 작업을 제출하지 못했습니다.", 502)
            if on_submitted is not None:
                on_submitted(job_id, str(status))
        else:
            logger.info("기존 RunPod OCR 작업 조회 재개 runpod_job_id=%s", job_id)

        last_status: str | None = None
        while True:
            if time.monotonic() >= deadline:
                self.cancel(job_id)
                raise OcrTransportError(
                    "RUNPOD_CLIENT_TIMEOUT",
                    "OCR 작업 시간 초과",
                    "계약서 처리가 제한 시간을 초과했습니다. 잠시 후 다시 시도해 주세요.",
                    504,
                )
            payload = self._request_json("GET", f"/status/{job_id}", deadline=deadline)
            status = str(payload.get("status", ""))
            if status != last_status:
                logger.info("RunPod OCR 상태 runpod_job_id=%s status=%s", job_id, status)
                last_status = status
            if on_status is not None:
                on_status(status)
            if status in _PENDING:
                time.sleep(
                    min(
                        settings.RUNPOD_STATUS_POLL_SECONDS,
                        max(deadline - time.monotonic(), 0),
                    )
                )
                continue
            if status == "COMPLETED":
                return self._validate_output(payload.get("output"), job_id)
            if status in _TERMINAL:
                http_status = 504 if status == "TIMED_OUT" else 503
                raise OcrTransportError(
                    f"RUNPOD_{status}",
                    f"OCR 작업 {status}",
                    "OCR 작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                    http_status,
                )
            raise AppError("OCR 상태 확인 실패", "OCR 작업 상태를 확인하지 못했습니다.", 502)

    def _validate_output(self, output: object, job_id: str) -> OcrAnalysisResult:
        if isinstance(output, dict) and isinstance(output.get("error"), dict):
            code = str(output["error"].get("code", "OCR_INTERNAL_ERROR"))
            logger.warning("RunPod OCR 안전 오류 runpod_job_id=%s error_code=%s", job_id, code)
            status = 422 if code in _INPUT_ERROR_CODES else 503
            raise OcrTransportError(
                code,
                "계약서 처리 실패",
                "계약서를 OCR 처리하지 못했습니다. 파일 상태를 확인해 주세요."
                if status == 422
                else "OCR 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
                status,
            )
        try:
            result = OcrAnalysisResult.model_validate(output)
            base64.b64decode(result.masked_pdf_base64, validate=True)
            return result
        except (ValidationError, ValueError, TypeError) as exc:
            logger.warning("RunPod OCR 응답 검증 실패 runpod_job_id=%s", job_id)
            raise AppError("OCR 결과 오류", "OCR 처리 결과를 확인하지 못했습니다.", 502) from exc

    def _request_json(
        self,
        method: str,
        path: str,
        *,
        deadline: float,
        json_body: dict[str, object] | None = None,
    ) -> dict[str, object]:
        attempt = 0
        while True:
            attempt += 1
            try:
                response = httpx.request(
                    method,
                    f"{self.base_url}{path}",
                    headers=self.headers,
                    json=json_body,
                    timeout=min(
                        settings.RUNPOD_HTTP_TIMEOUT_SECONDS,
                        max(deadline - time.monotonic(), 0.1),
                    ),
                )
            except httpx.HTTPError as exc:
                raise OcrTransportError(
                    "RUNPOD_UNAVAILABLE",
                    "OCR 서버 연결 실패",
                    "OCR 처리 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                    503,
                ) from exc

            if response.status_code == 404 and path.startswith("/status/"):
                raise OcrTransportError(
                    "RUNPOD_JOB_EXPIRED",
                    "OCR 작업 만료",
                    "OCR 작업 결과가 만료되었습니다. 다시 시도해 주세요.",
                    504,
                )
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= _TRANSIENT_REQUEST_ATTEMPTS or time.monotonic() >= deadline:
                    code = 429 if response.status_code == 429 else 503
                    raise OcrTransportError(
                        "RUNPOD_RATE_LIMITED" if code == 429 else "RUNPOD_UNAVAILABLE",
                        "OCR 서버 요청 제한" if code == 429 else "OCR 서버 장애",
                        "OCR 요청이 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
                        code,
                    )
                delay = min(0.5 * (2 ** (attempt - 1)), 8.0) * (0.5 + random.random() / 2)
                time.sleep(min(delay, max(deadline - time.monotonic(), 0)))
                continue
            if not 200 <= response.status_code < 300:
                logger.warning(
                    "RunPod API 요청 거부 operation=%s status=%d",
                    path.split("/")[1],
                    response.status_code,
                )
                raise AppError("OCR 서버 요청 실패", "OCR 서버가 요청을 처리하지 못했습니다.", 502)
            try:
                payload = response.json()
            except ValueError as exc:
                raise AppError(
                    "OCR 서버 응답 오류", "OCR 서버 응답을 확인하지 못했습니다.", 502
                ) from exc
            if not isinstance(payload, dict):
                raise AppError("OCR 서버 응답 오류", "OCR 서버 응답을 확인하지 못했습니다.", 502)
            return payload

    def cancel(self, job_id: str) -> None:
        try:
            httpx.post(
                f"{self.base_url}/cancel/{job_id}",
                headers=self.headers,
                timeout=settings.RUNPOD_HTTP_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError:
            logger.warning("RunPod OCR 취소 요청 실패 runpod_job_id=%s", job_id)


class OcrWorkerClient:
    """설정에 따라 기존 direct HTTP 또는 RunPod Serverless transport를 선택한다."""

    @staticmethod
    def _base_headers() -> dict[str, str]:
        return DirectHttpTransport.base_headers()

    @property
    def is_serverless(self) -> bool:
        return settings.OCR_TRANSPORT.strip().lower() == "runpod_serverless"

    def health(self) -> OcrWorkerHealth:
        if self.is_serverless:
            if not settings.RUNPOD_ENDPOINT_ID.strip() or not settings.RUNPOD_API_KEY.strip():
                raise OcrTransportError(
                    "RUNPOD_CONFIG_INVALID",
                    "OCR 서버 설정 오류",
                    "OCR 처리 서버가 설정되지 않았습니다.",
                    503,
                )
            return OcrWorkerHealth(status="ok", model="runpod-serverless", model_loaded=False)
        return DirectHttpTransport().health()

    def process_for_analysis(
        self,
        filename: str,
        content: bytes | None = None,
        *,
        source_url_factory: SignedUrlFactory | None = None,
        external_job_id: str | None = None,
        on_submitted: ExternalJobCallback | None = None,
        on_status: StatusCallback | None = None,
    ) -> OcrAnalysisResult:
        if not self.is_serverless:
            if content is None:
                raise AppError("OCR 입력 오류", "OCR 처리할 파일을 읽지 못했습니다.", 422)
            return DirectHttpTransport().process(filename, content)
        if source_url_factory is None:
            raise AppError("OCR 입력 오류", "OCR 처리할 파일을 준비하지 못했습니다.", 503)
        return RunpodServerlessTransport().process(
            filename,
            source_url_factory=source_url_factory,
            external_job_id=external_job_id,
            on_submitted=on_submitted,
            on_status=on_status,
        )
