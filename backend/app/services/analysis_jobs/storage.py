"""분석 원본용 비공개 Supabase Storage 접근.

브라우저가 Storage 키를 알지 못하게 모든 요청은 백엔드의 service-role 키로 수행한다.
오브젝트 경로에는 사용자가 올린 파일명을 넣지 않고 ``user/job/순번.확장자``만 사용한다.
"""

import logging
import uuid
from collections.abc import Sequence
from pathlib import Path
from urllib.parse import quote

import httpx

from app.core.config import settings
from app.core.exceptions import AppError

logger = logging.getLogger(__name__)

Payload = tuple[str, bytes]

_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}


def _require_config() -> tuple[str, str, str]:
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise AppError(
            "분석 파일 저장소 사용 불가",
            "분석 파일을 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            503,
        )
    return (
        settings.SUPABASE_URL.rstrip("/"),
        settings.SUPABASE_SERVICE_ROLE_KEY,
        settings.ANALYSIS_UPLOAD_BUCKET,
    )


def _headers(key: str, *, content_type: str | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {key}", "apikey": key}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def object_path(user_id: uuid.UUID, job_id: uuid.UUID, index: int, filename: str) -> str:
    suffix = Path(filename).suffix.lower()
    return f"{user_id}/{job_id}/{index:03d}{suffix}"


def _object_url(base_url: str, bucket: str, path: str) -> str:
    return f"{base_url}/storage/v1/object/{quote(bucket, safe='')}/{quote(path, safe='/')}"


def upload_job_files(user_id: uuid.UUID, job_id: uuid.UUID, payloads: Sequence[Payload]) -> None:
    """DB 작업을 공개하기 전에 원본 전부를 Storage에 올린다.

    중간 업로드가 실패하면 이미 올라간 오브젝트를 최선 노력으로 지운다.
    """
    base_url, key, bucket = _require_config()
    uploaded: list[str] = []
    try:
        with httpx.Client(timeout=settings.ANALYSIS_STORAGE_TIMEOUT_SECONDS) as client:
            for index, (filename, content) in enumerate(payloads):
                path = object_path(user_id, job_id, index, filename)
                response = client.post(
                    _object_url(base_url, bucket, path),
                    content=content,
                    headers={
                        **_headers(key, content_type=_CONTENT_TYPES[Path(filename).suffix.lower()]),
                        "x-upsert": "false",
                        "cache-control": "no-store",
                    },
                )
                response.raise_for_status()
                uploaded.append(path)
    except (httpx.HTTPError, KeyError) as exc:
        _remove_paths(uploaded)
        status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
        logger.warning("분석 원본 Storage 업로드 실패 status=%s", status, exc_info=True)
        raise AppError(
            "분석 파일 업로드 실패",
            "분석 파일을 안전하게 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            503,
        ) from exc


def download_job_file(user_id: uuid.UUID, job_id: uuid.UUID, index: int, filename: str) -> bytes:
    base_url, key, bucket = _require_config()
    path = object_path(user_id, job_id, index, filename)
    try:
        response = httpx.get(
            _object_url(base_url, bucket, path),
            headers=_headers(key),
            timeout=settings.ANALYSIS_STORAGE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        logger.warning("분석 원본 Storage 다운로드 실패 status=%s", status)
        # Supabase Storage는 없는 private object를 HTTP 400으로 응답하면서 본문의
        # statusCode=404/code=NoSuchKey로 표현한다. 이 경우는 재시도해도 생기지 않으므로
        # 일시 장애(503)가 아니라 입력 원본 소실(422)로 닫는다.
        if _is_missing_object_response(exc.response):
            raise AppError(
                "분석 파일 없음",
                "업로드한 파일을 찾지 못했습니다. 다시 업로드해 주세요.",
                422,
            ) from exc
        raise AppError(
            "분석 파일 다운로드 실패",
            "분석 파일 저장소가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
            503,
        ) from exc
    except httpx.HTTPError as exc:
        logger.warning("분석 원본 Storage 다운로드 실패", exc_info=True)
        raise AppError(
            "분석 파일 다운로드 실패",
            "분석 파일 저장소가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
            503,
        ) from exc
    return response.content


def _is_missing_object_response(response: httpx.Response) -> bool:
    if response.status_code == 404:
        return True
    if response.status_code != 400:
        return False
    try:
        payload = response.json()
    except ValueError:
        return False
    return payload.get("statusCode") == "404" or payload.get("code") == "NoSuchKey"


def discard_job(user_id: uuid.UUID, job_id: uuid.UUID, file_names: Sequence[str]) -> None:
    """분석 종료 후 원본을 삭제한다. 정리 실패가 분석 결과를 뒤집지는 않는다."""
    paths = [object_path(user_id, job_id, index, name) for index, name in enumerate(file_names)]
    _remove_paths(paths)


def _remove_paths(paths: Sequence[str]) -> None:
    if not paths:
        return
    try:
        base_url, key, bucket = _require_config()
        response = httpx.request(
            "DELETE",
            f"{base_url}/storage/v1/object/{quote(bucket, safe='')}",
            json={"prefixes": list(paths)},
            headers={**_headers(key), "Content-Type": "application/json"},
            timeout=settings.ANALYSIS_STORAGE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except Exception:
        # 원본 내용이나 service-role 키를 로그에 남기지 않는다.
        logger.warning("분석 원본 Storage 정리 실패 count=%d", len(paths), exc_info=True)
