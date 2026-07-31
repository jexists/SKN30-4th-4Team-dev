import io
import json
from urllib.error import HTTPError, URLError

import pytest

from app.core.config import settings
from app.core.exceptions import AppError
from app.services.document_processing import client as client_module
from app.services.document_processing.client import OcrWorkerClient

_OK_PAYLOAD = {
    "sanitized_text": "본문",
    "redaction_counts": {},
    "redaction_scope": [],
    "text_safe_for_analysis": True,
    "mask_count": 0,
    "coarse_mask_count": 0,
    "review_required": False,
    "masked_pdf_media_type": "application/pdf",
    "masked_pdf_base64": "",
}


class _FakeResponse:
    def __init__(self, payload: dict):
        self._raw = json.dumps(payload).encode()

    def read(self) -> bytes:
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *exc_info) -> bool:
        return False


def _raise_http_error(monkeypatch, status: int, body: bytes = b"") -> None:
    """process_for_analysis 가 워커에게서 HTTP status 를 받은 상황을 만든다."""

    def fake_urlopen(request, timeout=None):  # noqa: ARG001
        raise HTTPError(
            "https://worker.example/v1/process-for-analysis",
            status,
            "err",
            {},  # type: ignore[arg-type]
            io.BytesIO(body),
        )

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)


def _record_calls(monkeypatch, responder) -> list[str]:
    """요청이 간 URL 을 순서대로 모은다 — 폴백이 실제로 일어났는지 보려면 순서가 필요하다."""
    seen: list[str] = []

    def fake_urlopen(request, timeout=None):  # noqa: ARG001
        seen.append(request.full_url)
        return responder(request.full_url)

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)
    return seen


@pytest.fixture
def with_fallback(monkeypatch):
    monkeypatch.setattr(settings, "OCR_WORKER_URL", "https://primary.example")
    monkeypatch.setattr(settings, "OCR_WORKER_API_KEY", "primary-key")
    monkeypatch.setattr(settings, "OCR_FALLBACK_WORKER_URL", "https://fallback.example")
    monkeypatch.setattr(settings, "OCR_FALLBACK_WORKER_API_KEY", "fallback-key")


@pytest.fixture(autouse=True)
def _no_fallback_by_default(monkeypatch):
    """폴백 미설정이 기본값이다. 켠 테스트만 with_fallback 을 쓴다."""
    monkeypatch.setattr(settings, "OCR_FALLBACK_WORKER_URL", "")


def test_ocr_worker_client_adds_api_key_when_configured():
    assert OcrWorkerClient._headers("runpod-secret")["X-API-Key"] == "runpod-secret"


def test_ocr_worker_client_omits_empty_api_key():
    assert "X-API-Key" not in OcrWorkerClient._headers("")


def test_ocr_worker_client_always_sends_user_agent():
    """User-Agent 는 키 유무와 무관하게 항상 붙어야 한다.

    Worker 를 외부 GPU 호스팅에 두면 앞단 Cloudflare 가 urllib 기본 UA 를 봇으로 보고
    403(error 1010)으로 막는다. 이 헤더가 빠지면 워커가 살아 있는데도 백엔드는 503 을 낸다.
    """
    assert OcrWorkerClient._headers("")["User-Agent"].startswith("Mozilla/5.0")
    assert OcrWorkerClient._headers("runpod-secret")["User-Agent"].startswith("Mozilla/5.0")


@pytest.mark.parametrize("status", [413, 415, 422])
def test_document_rejection_stays_422(monkeypatch, status):
    """워커가 문서를 거부한 것만 사용자 파일 문제(422)로 올린다 — 재시도해도 결과가 같다."""
    _raise_http_error(monkeypatch, status, '{"detail":"PDF는 최대 20페이지까지"}'.encode())

    with pytest.raises(AppError) as caught:
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert caught.value.code == 422


@pytest.mark.parametrize("status", [401, 403, 404, 429])
def test_infrastructure_4xx_becomes_retryable_503(monkeypatch, status):
    """문서와 무관한 4xx 는 503 이어야 한다.

    RunPod pod 이 내려가면 프록시가 **404** 를, Cloudflare 는 403 을, 키가 틀리면 워커가 401 을
    준다. 예전엔 이 셋이 전부 422 "파일 상태를 확인해 주세요" 로 나가서 (1) 서버 장애를 사용자
    파일 탓으로 돌리고 (2) 422 가 재시도 대상이 아니라 분석이 몇 초 만에 즉시 실패로 닫혔다.
    """
    _raise_http_error(monkeypatch, status)

    with pytest.raises(AppError) as caught:
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert caught.value.code == 503
    # 사용자에게 파일을 의심하라고 말하지 않는다.
    assert "파일" not in caught.value.message


# ── 폴백 라우팅 ────────────────────────────────────────────────────────


def test_no_fallback_configured_sends_one_request(monkeypatch):
    """폴백 URL 이 비면 1차에만 보낸다 — 기존 동작 그대로다."""
    monkeypatch.setattr(settings, "OCR_WORKER_URL", "https://primary.example")

    def responder(url):  # noqa: ARG001
        raise URLError("connection refused")

    seen = _record_calls(monkeypatch, responder)

    with pytest.raises(AppError):
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert len(seen) == 1
    assert seen[0].startswith("https://primary.example")


def test_falls_back_when_primary_unreachable(monkeypatch, with_fallback):
    """1차가 연결 실패면 2차로 넘어가고, 2차가 성공하면 그 결과를 쓴다."""

    def responder(url):
        if url.startswith("https://primary.example"):
            raise URLError("connection refused")
        return _FakeResponse(_OK_PAYLOAD)

    seen = _record_calls(monkeypatch, responder)

    result = OcrWorkerClient().process_for_analysis("contract.png", b"\x89PNG")

    assert result.sanitized_text == "본문"
    assert [url.split("/v1/")[0] for url in seen] == [
        "https://primary.example",
        "https://fallback.example",
    ]


@pytest.mark.parametrize("status", [500, 502, 404, 403])
def test_falls_back_on_infrastructure_status(monkeypatch, with_fallback, status):
    """RunPod pod 다운(404)·Cloudflare 차단(403)·워커 5xx 는 전부 폴백 대상이다."""

    def responder(url):
        if url.startswith("https://primary.example"):
            raise HTTPError(url, status, "err", {}, io.BytesIO(b""))  # type: ignore[arg-type]
        return _FakeResponse(_OK_PAYLOAD)

    seen = _record_calls(monkeypatch, responder)

    assert OcrWorkerClient().process_for_analysis("contract.png", b"\x89PNG").mask_count == 0
    assert len(seen) == 2


@pytest.mark.parametrize("status", [413, 415, 422])
def test_document_rejection_does_not_fall_back(monkeypatch, with_fallback, status):
    """문서 자체가 거부되면 2차로 넘기지 않는다.

    어느 워커로 보내도 같은 결과이므로, 넘기면 같은 문서를 두 번 처리하며 파일 하나의
    최악 소요만 두 배가 된다(lease 계산이 깨진다).
    """

    def responder(url):
        raise HTTPError(url, status, "err", {}, io.BytesIO(b""))  # type: ignore[arg-type]

    seen = _record_calls(monkeypatch, responder)

    with pytest.raises(AppError) as caught:
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert caught.value.code == 422
    assert len(seen) == 1


def test_both_targets_failing_reports_last_error(monkeypatch, with_fallback):
    """둘 다 실패하면 재시도 가능한 503 으로 올린다 — 워커가 이 작업을 다시 집게 해야 한다."""

    def responder(url):  # noqa: ARG001
        raise URLError("connection refused")

    seen = _record_calls(monkeypatch, responder)

    with pytest.raises(AppError) as caught:
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert caught.value.code == 503
    assert len(seen) == 2


def test_each_target_gets_its_own_api_key(monkeypatch, with_fallback):
    """1차와 2차는 다른 호스트라 공유 비밀도 다르다 — 키가 섞이면 401 이 난다."""
    keys: list[str | None] = []

    def fake_urlopen(request, timeout=None):  # noqa: ARG001
        keys.append(request.get_header("X-api-key"))
        if request.full_url.startswith("https://primary.example"):
            raise URLError("down")
        return _FakeResponse(_OK_PAYLOAD)

    monkeypatch.setattr(client_module, "urlopen", fake_urlopen)

    OcrWorkerClient().process_for_analysis("contract.png", b"\x89PNG")

    assert keys == ["primary-key", "fallback-key"]


def test_same_url_is_not_retried_as_fallback(monkeypatch):
    """폴백 URL 이 1차와 같으면 붙이지 않는다 — 같은 곳에 두 번 보낼 이유가 없다."""
    monkeypatch.setattr(settings, "OCR_WORKER_URL", "https://only.example")
    monkeypatch.setattr(settings, "OCR_FALLBACK_WORKER_URL", "https://only.example/")

    def responder(url):  # noqa: ARG001
        raise URLError("down")

    seen = _record_calls(monkeypatch, responder)

    with pytest.raises(AppError):
        OcrWorkerClient().process_for_analysis("contract.pdf", b"%PDF-1.7")

    assert len(seen) == 1


def test_health_reports_which_target_answered(monkeypatch, with_fallback):
    """1차가 죽고 2차가 살아 있으면 target=fallback 으로 알린다."""

    def responder(url):
        if url.startswith("https://primary.example"):
            raise URLError("down")
        return _FakeResponse(
            {
                "status": "ok",
                "model": "PaddlePaddle/PaddleOCR-VL-1.6",
                "model_loaded": True,
                "provider": "tesseract",
            }
        )

    _record_calls(monkeypatch, responder)

    health = OcrWorkerClient().health()

    assert health.target == "fallback"
    assert health.provider == "tesseract"
