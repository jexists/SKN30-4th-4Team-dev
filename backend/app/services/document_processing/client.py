import base64
import json
import logging
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import OcrAnalysisResult, OcrWorkerHealth

logger = logging.getLogger(__name__)

#: 워커가 준 오류 본문을 로그에 남길 때의 상한. 트레이스백이 통째로 오면 로그를 덮어버린다.
_ERROR_BODY_MAX_CHARS = 800


def _error_body(exc: HTTPError) -> str:
    """워커가 4xx/5xx 와 함께 보낸 본문을 로그용으로 꺼낸다.

    이게 없으면 "422 받음"까지만 알고 **왜** 거부됐는지는 워커 로그를 따로 뒤져야 한다.
    본문은 로그에만 쓰고 사용자 응답에는 넣지 않는다(내부 정보 노출 방지).
    """
    try:
        raw = exc.read()
    except Exception:  # 본문을 못 읽는다고 원래 오류를 가리면 안 된다.
        return "<본문 읽기 실패>"
    if not raw:
        return "<본문 없음>"
    text = raw.decode("utf-8", errors="replace").strip()
    if len(text) > _ERROR_BODY_MAX_CHARS:
        return text[:_ERROR_BODY_MAX_CHARS] + "…(생략)"
    return text


# Worker 를 외부 GPU 호스팅(RunPod 등)에 두면 그 앞단이 Cloudflare 인 경우가 있다.
# urllib 기본값인 "Python-urllib/3.x" 는 봇으로 판정돼 Pod 에 닿기도 전에 403(error 1010)으로
# 막힌다 — 워커가 죽은 것처럼 보이지만 실제로는 요청이 도착조차 하지 않는다.
_USER_AGENT = "Mozilla/5.0 (compatible; homeshield-backend/1.0)"


class OcrWorkerClient:
    """내부 OCR worker의 상태 확인과 계약서 처리 API를 호출한다."""

    @staticmethod
    def _base_headers() -> dict[str, str]:
        headers = {"User-Agent": _USER_AGENT}
        if settings.OCR_WORKER_API_KEY:
            headers["X-API-Key"] = settings.OCR_WORKER_API_KEY
        return headers

    def health(self) -> OcrWorkerHealth:
        url = f"{settings.OCR_WORKER_URL.rstrip('/')}/health"
        request = Request(url, headers=self._base_headers())
        try:
            with urlopen(  # noqa: S310
                request, timeout=settings.OCR_WORKER_TIMEOUT_SECONDS
            ) as response:
                payload = json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            detail = (
                _error_body(exc)
                if isinstance(exc, HTTPError)
                else repr(getattr(exc, "reason", exc))
            )
            logger.warning("OCR Worker 헬스체크 실패 url=%s detail=%s", url, detail)
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
                **self._base_headers(),
            },
        )
        # 어느 파일에서 멈췄는지 로그만 보고 알 수 있어야 한다 — 원본 파일명은 남기지 않고
        # (개인정보가 들어가는 자리다) 확장자·크기만 남긴다.
        context = f"url={url} type={safe_content_type} size={len(content)}B"
        started = time.perf_counter()
        try:
            with urlopen(  # noqa: S310
                request, timeout=settings.OCR_WORKER_PROCESS_TIMEOUT_SECONDS
            ) as response:
                payload = json.loads(response.read())
            result = OcrAnalysisResult.model_validate(payload)
            base64.b64decode(result.masked_pdf_base64, validate=True)
            logger.info(
                "OCR Worker 처리 완료 %s elapsed=%.1fs text=%d자 masks=%d",
                context,
                time.perf_counter() - started,
                len(result.sanitized_text),
                result.mask_count,
            )
            return result
        except HTTPError as exc:
            # 워커가 붙여 보낸 사유(FastAPI 라면 {"detail": ...})가 여기 들어 있다.
            logger.warning(
                "OCR Worker 처리 거부 status=%s %s elapsed=%.1fs body=%s",
                exc.code,
                context,
                time.perf_counter() - started,
                _error_body(exc),
            )
            raise AppError(
                "계약서 처리 실패",
                "계약서를 OCR 처리하지 못했습니다. 파일 상태를 확인해 주세요.",
                422 if 400 <= exc.code < 500 else 503,
            ) from exc
        except (URLError, TimeoutError) as exc:
            # 타임아웃과 연결 거부는 대응이 완전히 다르다(워커가 느린 것 vs 안 떠 있는 것).
            logger.warning(
                "OCR Worker 연결 실패 %s elapsed=%.1fs timeout=%ss reason=%r",
                context,
                time.perf_counter() - started,
                settings.OCR_WORKER_PROCESS_TIMEOUT_SECONDS,
                getattr(exc, "reason", exc),
            )
            raise AppError(
                "OCR 서버 연결 실패",
                "계약서 처리 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
                503,
            ) from exc
        except (json.JSONDecodeError, ValueError) as exc:
            logger.exception("OCR Worker 응답 검증 실패 %s", context)
            raise AppError(
                "계약서 처리 실패",
                "OCR 처리 결과를 확인하지 못했습니다.",
                502,
            ) from exc
