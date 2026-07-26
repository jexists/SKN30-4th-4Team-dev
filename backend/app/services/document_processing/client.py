import json
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import OcrWorkerHealth


class OcrWorkerClient:
    """내부 OCR worker용 최소 클라이언트.

    계약서 전송/작업 큐 API는 Spotting PoC가 끝난 뒤 이 클래스에 추가한다.
    현재는 배포 연결을 확인할 수 있는 health 호출만 제공한다.
    """

    def health(self) -> OcrWorkerHealth:
        url = f"{settings.OCR_WORKER_URL.rstrip('/')}/health"
        try:
            with urlopen(url, timeout=settings.OCR_WORKER_TIMEOUT_SECONDS) as response:  # noqa: S310
                payload = json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise AppError(
                "OCR_WORKER_UNAVAILABLE",
                "OCR 처리 서버에 연결할 수 없습니다.",
                503,
            ) from exc
        return OcrWorkerHealth.model_validate(payload)
