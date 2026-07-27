import json
from typing import Literal

import httpx
from pydantic import ValidationError

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import OcrExtractionResponse, OcrWorkerHealth


class OcrWorkerClient:
    """백엔드와 내부 OCR worker 사이의 동기 HTTP 클라이언트."""

    @staticmethod
    def _unavailable(exc: Exception) -> AppError:
        return AppError(
            "OCR 처리 서버 오류",
            "OCR 처리 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            503,
        )

    def health(self) -> OcrWorkerHealth:
        url = f"{settings.OCR_WORKER_URL.rstrip('/')}/health"
        try:
            response = httpx.get(url, timeout=settings.OCR_WORKER_TIMEOUT_SECONDS)
            response.raise_for_status()
            return OcrWorkerHealth.model_validate(response.json())
        except (httpx.HTTPError, json.JSONDecodeError, ValidationError) as exc:
            raise self._unavailable(exc) from exc

    def extract(
        self,
        *,
        file_name: str,
        content: bytes,
        content_type: str,
        mode: Literal["contract_bundle", "registry"],
    ) -> OcrExtractionResponse:
        url = f"{settings.OCR_WORKER_URL.rstrip('/')}/v1/extract"
        try:
            response = httpx.post(
                url,
                data={"mode": mode},
                files={"file": (file_name, content, content_type)},
                timeout=settings.OCR_WORKER_PROCESS_TIMEOUT_SECONDS,
            )
        except httpx.TimeoutException as exc:
            raise AppError(
                "문서 처리 시간 초과",
                "OCR 처리가 오래 걸리고 있습니다. 문서 페이지 수를 줄여 다시 시도해 주세요.",
                504,
            ) from exc
        except httpx.RequestError as exc:
            raise self._unavailable(exc) from exc

        if response.is_error:
            detail = "문서를 OCR 처리하지 못했습니다. 파일 상태를 확인해 주세요."
            try:
                payload = response.json()
                if isinstance(payload, dict) and isinstance(payload.get("detail"), str):
                    detail = payload["detail"]
            except json.JSONDecodeError:
                pass
            code = response.status_code if 400 <= response.status_code < 500 else 503
            raise AppError("문서 처리 실패", detail, code)

        try:
            return OcrExtractionResponse.model_validate(response.json())
        except (json.JSONDecodeError, ValidationError) as exc:
            raise AppError(
                "OCR 응답 오류",
                "OCR 처리 결과 형식을 확인하지 못했습니다.",
                502,
            ) from exc
