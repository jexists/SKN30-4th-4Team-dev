import base64
import json
import logging
import time
import uuid
from dataclasses import dataclass
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

# Worker 가 "이 문서로는 못 한다"고 판단해서 돌려주는 상태 코드. 이것만 사용자 파일 문제다
# (415 지원하지 않는 형식 · 413 크기 초과 · 422 페이지 수 초과·마스킹 검증 실패).
# 나머지 4xx 는 **문서와 무관한 우리 쪽 인프라 문제**다 — RunPod pod 이 내려가 프록시가 404 를
# 주거나, Cloudflare 가 403(error 1010) 으로 막거나, API 키가 틀려 401 이 오는 경우다.
# 이걸 뭉쳐서 422 로 내면 서버 장애를 "파일 상태를 확인해 주세요" 로 사용자에게 떠넘기고,
# 게다가 워커의 RETRYABLE_STATUS 에 없어 재시도 없이 즉시 실패로 닫힌다.
#
# **폴백 분기의 기준이기도 하다.** 여기 속하면 다른 워커로 보내도 결과가 같으므로 넘기지
# 않는다(같은 문서를 두 번 처리하며 시간만 두 배로 쓴다). 나머지는 1차 워커의 문제이므로
# 2차 워커로 넘긴다.
_DOCUMENT_REJECTED_STATUS = frozenset({413, 415, 422})


@dataclass(frozen=True)
class _WorkerTarget:
    """요청을 보낼 워커 하나. 1차(RunPod)와 2차(EC2 tesseract)는 URL·키·타임아웃이 모두 다르다."""

    name: str
    url: str
    api_key: str
    process_timeout: float


def _targets() -> list[_WorkerTarget]:
    """1차 → 2차 순서의 시도 대상. 폴백 URL 이 비면 1차 하나만 돌려준다(기존 동작).

    두 URL 이 같으면 폴백을 붙이지 않는다 — 같은 호스트에 두 번 보내봐야 결과가 같고
    파일 하나의 최악 소요만 두 배가 된다.
    """
    primary_url = settings.OCR_WORKER_URL.strip()
    targets = [
        _WorkerTarget(
            name="primary",
            url=primary_url,
            api_key=settings.OCR_WORKER_API_KEY,
            process_timeout=settings.OCR_WORKER_PROCESS_TIMEOUT_SECONDS,
        )
    ]

    fallback_url = settings.OCR_FALLBACK_WORKER_URL.strip()
    if fallback_url and fallback_url.rstrip("/") != primary_url.rstrip("/"):
        targets.append(
            _WorkerTarget(
                name="fallback",
                url=fallback_url,
                api_key=settings.OCR_FALLBACK_WORKER_API_KEY,
                process_timeout=settings.OCR_FALLBACK_PROCESS_TIMEOUT_SECONDS,
            )
        )
    return targets


class _TargetUnavailable(Exception):
    """이 워커는 인프라 사유로 실패했다 — 다음 대상이 있으면 넘어가도 된다.

    마지막 대상까지 실패하면 여기 담아 둔 AppError 를 그대로 올린다. 원래의 상태 코드
    구분(503 연결 실패 / 502 응답 검증 실패)이 폴백 때문에 뭉개지지 않게 하려는 것이다.
    """

    def __init__(self, error: AppError):
        super().__init__(error.message)
        self.error = error


class OcrWorkerClient:
    """내부 OCR worker의 상태 확인과 계약서 처리 API를 호출한다.

    1차 워커가 인프라 사유로 실패하면 2차 워커로 넘긴다(설정된 경우). 폴백 여부는
    호출부가 알 필요가 없으므로 이 클래스 안에서 끝낸다.
    """

    @staticmethod
    def _headers(api_key: str) -> dict[str, str]:
        headers = {"User-Agent": _USER_AGENT}
        if api_key:
            headers["X-API-Key"] = api_key
        return headers

    # ── 상태 확인 ──────────────────────────────────────────────────────

    def health(self) -> OcrWorkerHealth:
        """살아 있는 첫 워커의 상태를 돌려준다.

        1차가 죽고 2차가 살아 있으면 2차 상태를 `target="fallback"` 으로 돌려준다 —
        "어디로든 처리는 된다"와 "1차가 죽었다"를 한 응답에서 함께 읽을 수 있어야 한다.
        """
        last_error: AppError | None = None
        for target in _targets():
            try:
                return self._health_of(target)
            except AppError as exc:
                last_error = exc
        assert last_error is not None  # _targets() 는 최소 하나를 돌려준다.
        raise last_error

    def _health_of(self, target: _WorkerTarget) -> OcrWorkerHealth:
        url = f"{target.url.rstrip('/')}/health"
        request = Request(url, headers=self._headers(target.api_key))
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
            logger.warning(
                "OCR Worker 헬스체크 실패 target=%s url=%s detail=%s", target.name, url, detail
            )
            raise AppError(
                "OCR_WORKER_UNAVAILABLE",
                "OCR 처리 서버에 연결할 수 없습니다.",
                503,
            ) from exc
        return OcrWorkerHealth.model_validate(payload).model_copy(
            update={"target": target.name}
        )

    # ── 계약서 처리 ────────────────────────────────────────────────────

    def process_for_analysis(self, filename: str, content: bytes) -> OcrAnalysisResult:
        """파일을 OCR worker로 보내고 개인정보 치환 텍스트와 PDF를 받는다.

        1차가 인프라 사유로 실패하면 2차로 넘긴다. 문서 자체가 거부된 경우(413·415·422)는
        넘기지 않고 즉시 올린다 — 어느 워커로 보내도 같은 결과다.
        """
        targets = _targets()
        last_error: AppError | None = None

        for index, target in enumerate(targets):
            try:
                return self._process_on(target, filename, content)
            except _TargetUnavailable as exc:
                last_error = exc.error
                remaining = targets[index + 1 :]
                if not remaining:
                    break
                logger.warning(
                    "OCR Worker 폴백 전환 from=%s to=%s reason=%s",
                    target.name,
                    remaining[0].name,
                    exc.error.message,
                )

        assert last_error is not None  # 성공했으면 이미 return 했다.
        raise last_error

    def _process_on(
        self, target: _WorkerTarget, filename: str, content: bytes
    ) -> OcrAnalysisResult:
        url = f"{target.url.rstrip('/')}/v1/process-for-analysis"
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
                **self._headers(target.api_key),
            },
        )
        # 어느 파일에서 멈췄는지 로그만 보고 알 수 있어야 한다 — 원본 파일명은 남기지 않고
        # (개인정보가 들어가는 자리다) 확장자·크기만 남긴다.
        context = f"target={target.name} url={url} type={safe_content_type} size={len(content)}B"
        started = time.perf_counter()
        try:
            with urlopen(request, timeout=target.process_timeout) as response:  # noqa: S310
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
            rejected = exc.code in _DOCUMENT_REJECTED_STATUS
            logger.warning(
                "OCR Worker %s status=%s %s elapsed=%.1fs body=%s",
                "처리 거부" if rejected else "비정상 응답",
                exc.code,
                context,
                time.perf_counter() - started,
                _error_body(exc),
            )
            if rejected:
                # 폴백해도 같은 결과다 — 넘기지 않고 바로 사용자에게 올린다.
                raise AppError(
                    "계약서 처리 실패",
                    "계약서를 OCR 처리하지 못했습니다. 파일 상태를 확인해 주세요.",
                    422,
                ) from exc
            raise _TargetUnavailable(
                AppError(
                    "OCR 서버 연결 실패",
                    "계약서 처리 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
                    503,
                )
            ) from exc
        except (URLError, TimeoutError) as exc:
            # 타임아웃과 연결 거부는 대응이 완전히 다르다(워커가 느린 것 vs 안 떠 있는 것).
            logger.warning(
                "OCR Worker 연결 실패 %s elapsed=%.1fs timeout=%ss reason=%r",
                context,
                time.perf_counter() - started,
                target.process_timeout,
                getattr(exc, "reason", exc),
            )
            raise _TargetUnavailable(
                AppError(
                    "OCR 서버 연결 실패",
                    "계약서 처리 서버가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
                    503,
                )
            ) from exc
        except (json.JSONDecodeError, ValueError) as exc:
            # 형식이 깨진 응답은 그 워커가 오작동 중이라는 뜻이다 — 다음 대상으로 넘긴다.
            logger.exception("OCR Worker 응답 검증 실패 %s", context)
            raise _TargetUnavailable(
                AppError(
                    "계약서 처리 실패",
                    "OCR 처리 결과를 확인하지 못했습니다.",
                    502,
                )
            ) from exc
