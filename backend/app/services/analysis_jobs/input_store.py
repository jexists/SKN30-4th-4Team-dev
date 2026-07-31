"""분석 원본을 여러 백엔드 인스턴스가 공유하는 private Storage에 보관한다.

원본 파일명은 객체 경로에 넣지 않는다. 사용자가 만든 이름이 URL이나 로그로 새지 않게 하고,
작업을 선점한 어느 워커든 ``user_id/job_id/000`` 형식의 동일한 키로 읽을 수 있게 한다.
"""

import logging
import uuid
from collections.abc import Sequence
from pathlib import Path
from urllib.parse import urljoin

import httpx

from app.core.config import settings
from app.core.exceptions import AppError

logger = logging.getLogger(__name__)

_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
_TRANSIENT_STATUS = frozenset({408, 429})


def _configuration() -> tuple[str, str, str] | None:
    base_url = settings.SUPABASE_URL.strip().rstrip("/")
    service_key = settings.SUPABASE_SERVICE_ROLE_KEY.strip()
    bucket = settings.ANALYSIS_INPUT_BUCKET.strip()
    if not base_url or not service_key or not bucket:
        return None
    return base_url, service_key, bucket


def _require_configuration() -> tuple[str, str, str]:
    configured = _configuration()
    if configured is None:
        raise AppError(
            "분석 파일 저장소 사용 불가",
            "분석 파일 저장 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            503,
        )
    return configured


def _headers(service_key: str, *, content_type: str | None = None) -> dict[str, str]:
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey": service_key,
    }
    if content_type is not None:
        headers.update({"Content-Type": content_type, "x-upsert": "true"})
    return headers


def _object_key(user_id: uuid.UUID, job_id: uuid.UUID, index: int) -> str:
    return f"{user_id}/{job_id}/{index:03d}"


def _content_type(filename: str) -> str:
    return _CONTENT_TYPES.get(Path(filename).suffix.lower(), "application/octet-stream")


def _is_transient(status_code: int) -> bool:
    return status_code in _TRANSIENT_STATUS or status_code >= 500


def _is_missing_object(response: httpx.Response) -> bool:
    """Supabase 버전에 따라 없는 private 객체가 404 또는 JSON을 담은 400으로 내려온다."""
    if response.status_code == 404:
        return True
    if response.status_code != 400:
        return False
    try:
        error = response.json()
    except ValueError:
        return False
    return error.get("code") == "NoSuchKey" or error.get("error") == "not_found"


def _storage_error(
    *,
    operation: str,
    status_code: int | None,
    title: str,
    message: str,
) -> AppError:
    # 응답 본문에는 Storage 내부 정보가 들어갈 수 있어 로그나 사용자 응답에 포함하지 않는다.
    if status_code is None:
        logger.warning("분석 입력 Storage %s 중 네트워크 오류", operation)
        code = 503
    else:
        logger.warning("분석 입력 Storage %s 실패 status=%d", operation, status_code)
        code = 503 if _is_transient(status_code) else 502
    return AppError(title, message, code)


def store_all(
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    payloads: Sequence[tuple[str, bytes]],
) -> None:
    """분석 입력을 업로드 순서대로 저장한다.

    파일명은 DB 표시용 메타데이터일 뿐 Storage에는 쓰지 않는다. 중간 업로드가 실패하면 이미
    저장한 객체를 best-effort로 지운 뒤 원래 오류를 전달한다.
    """
    base_url, service_key, bucket = _require_configuration()
    attempted_count = 0

    try:
        for index, (filename, content) in enumerate(payloads):
            # 응답을 받기 전에 연결이 끊겨도 서버에는 저장됐을 수 있으므로, 시도한 키까지 정리한다.
            attempted_count = index + 1
            object_key = _object_key(user_id, job_id, index)
            url = f"{base_url}/storage/v1/object/{bucket}/{object_key}"
            try:
                response = httpx.post(
                    url,
                    content=content,
                    headers=_headers(service_key, content_type=_content_type(filename)),
                    timeout=settings.ANALYSIS_STORAGE_TIMEOUT_SECONDS,
                )
            except httpx.HTTPError as exc:
                raise _storage_error(
                    operation="업로드",
                    status_code=None,
                    title="분석 파일 업로드 실패",
                    message="분석 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                ) from exc

            if not 200 <= response.status_code < 300:
                raise _storage_error(
                    operation="업로드",
                    status_code=response.status_code,
                    title="분석 파일 업로드 실패",
                    message="분석 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                )
    except Exception:
        if attempted_count:
            discard(user_id, job_id, attempted_count)
        raise


def load(user_id: uuid.UUID, job_id: uuid.UUID, index: int) -> bytes:
    """private Storage에서 분석 입력 한 건을 읽는다."""
    base_url, service_key, bucket = _require_configuration()
    object_key = _object_key(user_id, job_id, index)
    url = f"{base_url}/storage/v1/object/authenticated/{bucket}/{object_key}"

    try:
        response = httpx.get(
            url,
            headers=_headers(service_key),
            timeout=settings.ANALYSIS_STORAGE_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise _storage_error(
            operation="다운로드",
            status_code=None,
            title="분석 파일 불러오기 실패",
            message="분석 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ) from exc

    if _is_missing_object(response):
        # 어떤 키가 비었는지 남긴다 — 이게 없으면 "업로드가 실패한 것"과 "다른 호스트가
        # 남긴 옛 작업을 집은 것"을 로그만으로 구분할 수 없다.
        logger.warning(
            "분석 입력 객체 없음 bucket=%s key=%s status=%d",
            bucket,
            object_key,
            response.status_code,
        )
        raise AppError(
            "분석 파일 없음",
            "업로드한 파일을 찾지 못했습니다. 다시 업로드해 주세요.",
            422,
        )
    if not 200 <= response.status_code < 300:
        raise _storage_error(
            operation="다운로드",
            status_code=response.status_code,
            title="분석 파일 불러오기 실패",
            message="분석 파일을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        )
    return response.content


def create_signed_url(
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    index: int,
    *,
    expires_in: int | None = None,
) -> str:
    """private 입력 객체 하나의 단기 URL을 만든다. service role key는 URL에 포함하지 않는다."""
    base_url, service_key, bucket = _require_configuration()
    ttl = expires_in or settings.ANALYSIS_SIGNED_URL_TTL_SECONDS
    runpod_ttl_seconds = (settings.RUNPOD_JOB_TTL_MS + 999) // 1000
    if ttl < runpod_ttl_seconds:
        raise AppError(
            "분석 설정 오류",
            "분석 파일 접근 시간을 설정하지 못했습니다.",
            503,
        )
    object_key = _object_key(user_id, job_id, index)
    url = f"{base_url}/storage/v1/object/sign/{bucket}/{object_key}"
    try:
        response = httpx.post(
            url,
            json={"expiresIn": ttl},
            headers=_headers(service_key),
            timeout=settings.ANALYSIS_STORAGE_TIMEOUT_SECONDS,
        )
    except httpx.HTTPError as exc:
        raise _storage_error(
            operation="서명 URL 생성",
            status_code=None,
            title="분석 파일 접근 실패",
            message="분석 파일을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        ) from exc
    if not 200 <= response.status_code < 300:
        raise _storage_error(
            operation="서명 URL 생성",
            status_code=response.status_code,
            title="분석 파일 접근 실패",
            message="분석 파일을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        )
    try:
        signed_path = response.json()["signedURL"]
    except (ValueError, KeyError, TypeError) as exc:
        logger.warning("분석 입력 Storage 서명 URL 응답 형식 오류")
        raise AppError(
            "분석 파일 접근 실패",
            "분석 파일을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            502,
        ) from exc
    if not isinstance(signed_path, str) or not signed_path:
        raise AppError(
            "분석 파일 접근 실패",
            "분석 파일을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            502,
        )
    return urljoin(f"{base_url}/", signed_path)


def discard(
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    count: int | None = None,
) -> None:
    """작업 입력을 best-effort로 지운다. 정리 실패는 본 작업 결과를 바꾸지 않는다."""
    configured = _configuration()
    if configured is None:
        return
    base_url, service_key, bucket = configured

    # Supabase remove는 이름이 ``prefixes``여도 폴더 접두사가 아니라 정확한 객체 경로 목록을
    # 받는다. 개수를 모르면 업로드 검증 상한까지 생성해, 존재 가능한 키만 일괄 삭제한다.
    delete_count = settings.CONTRACT_MAX_FILES if count is None else count
    if delete_count <= 0:
        return
    prefixes = [_object_key(user_id, job_id, index) for index in range(delete_count)]

    try:
        response = httpx.request(
            "DELETE",
            f"{base_url}/storage/v1/object/{bucket}",
            json={"prefixes": prefixes},
            headers=_headers(service_key),
            timeout=settings.ANALYSIS_STORAGE_TIMEOUT_SECONDS,
        )
        if not 200 <= response.status_code < 300 and response.status_code != 404:
            logger.warning("분석 입력 Storage 정리 실패 status=%d", response.status_code)
    except Exception:
        # cleanup은 호출자의 성공/실패 상태를 절대 덮어쓰지 않아야 한다. httpx 대역이나
        # 잘못된 런타임 설정 같은 예기치 않은 오류도 이 경계 안에서 끝낸다.
        logger.warning("분석 입력 Storage 정리 중 오류")
