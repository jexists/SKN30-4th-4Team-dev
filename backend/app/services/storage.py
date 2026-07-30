"""Supabase Storage 업로드 — 전용 SDK 없이 REST API 를 httpx 로 직접 호출한다.

버킷은 public 이라고 가정하고, 업로드 성공 시 공개 URL 을 그대로 돌려준다. 카카오 로그인의
profile_image(아바타 CDN URL)와 같은 계약을 유지해, 호출부는 "그냥 URL 문자열"로만 다루면 된다.
"""

import logging
import uuid
from pathlib import Path

import httpx

from app.core.config import settings
from app.core.exceptions import AppError

logger = logging.getLogger(__name__)


def upload_avatar(user_id: uuid.UUID, filename: str, content: bytes, content_type: str) -> str:
    """아바타 이미지를 업로드하고 공개 URL 을 돌려준다.

    설정(SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)이 비어 있으면 503 — 로컬 개발 등
    스토리지 미설정 환경에서도 서버 자체는 정상 기동하되, 이 기능만 안내와 함께 막힌다.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
        raise AppError(
            "이미지 저장소 사용 불가",
            "프로필 사진 저장 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            503,
        )

    suffix = Path(filename).suffix.lower() or ".jpg"
    object_path = f"{user_id}/{uuid.uuid4()}{suffix}"
    bucket = settings.AVATAR_BUCKET
    upload_url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{object_path}"

    try:
        # PUT 이 아니라 POST 다. Storage 에서 PUT /object 는 "이미 있는 오브젝트 갱신"이라
        # 매번 새 uuid 경로로 올리는 여기서는 항상 실패한다.
        resp = httpx.post(
            upload_url,
            content=content,
            headers={
                "Authorization": f"Bearer {settings.SUPABASE_SERVICE_ROLE_KEY}",
                "apikey": settings.SUPABASE_SERVICE_ROLE_KEY,
                "Content-Type": content_type,
                # 같은 사용자가 짧은 시간에 다시 올려도 경합 없이 덮어쓸 수 있게 한다.
                "x-upsert": "true",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # Storage 는 "버킷 없음" 같은 원인도 본문에만 담아 400 으로 내려준다.
        # 본문을 남기지 않으면 상태 코드만 보고는 원인을 알 수 없다.
        logger.error("아바타 업로드 실패 (%s): %s", exc.response.status_code, exc.response.text)
        raise AppError(
            "업로드 실패",
            "프로필 사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            502,
        ) from exc
    except httpx.HTTPError as exc:
        logger.exception("아바타 업로드 실패")
        raise AppError(
            "업로드 실패",
            "프로필 사진을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            502,
        ) from exc

    return f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_path}"
