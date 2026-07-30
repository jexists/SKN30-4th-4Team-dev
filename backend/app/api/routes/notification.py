"""알림 API — 목록·안읽음 개수·읽음 처리·삭제.

선택과 전체를 **엔드포인트 하나로 합쳤다**(`ids` 가 없으면 전체). 서버·프론트 양쪽에서 분기가
하나로 줄고, 단건 처리도 `ids: [하나]` 로 자연스럽게 표현된다.
"""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.cursor import decode_cursor, encode_cursor
from app.api.deps import RequireMember
from app.db.session import get_app_db
from app.models.notification import Notification
from app.repositories.notification import NotificationRepository
from app.schemas.common import ApiResponse, Page, success_response
from app.schemas.notification import (
    NotificationIdsIn,
    NotificationMutationOut,
    NotificationOut,
    UnreadCountOut,
)
from app.services.auth import claims_user_id

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])

AppDb = Annotated[Session, Depends(get_app_db)]
Limit = Annotated[int, Query(ge=1, le=100)]


@router.get("", response_model=ApiResponse[Page[NotificationOut]])
def list_notifications(
    user: RequireMember,
    db: AppDb,
    limit: Limit = 30,
    cursor: str | None = None,
    unread: bool = False,
) -> ApiResponse[Page[NotificationOut]]:
    """내 알림 (최신순, 커서 페이지네이션).

    unread 필터를 서버에서 하는 이유: 커서 페이지네이션과 클라이언트 필터를 섞으면
    "30개 받았는데 안읽음이 2개뿐" 인 빈 페이지가 생긴다.
    """
    uid = claims_user_id(user)
    rows, has_more = NotificationRepository(db).list_by_user(
        uid, limit=limit, cursor=decode_cursor(cursor), unread_only=unread
    )
    next_cursor = encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None
    return success_response(Page(items=[_out(row) for row in rows], next_cursor=next_cursor))


@router.get("/unread-count", response_model=ApiResponse[UnreadCountOut])
def unread_count(user: RequireMember, db: AppDb) -> ApiResponse[UnreadCountOut]:
    """헤더 Badge 용. 프론트가 주기적으로 부르므로 가볍게 유지한다(부분 인덱스 전담)."""
    uid = claims_user_id(user)
    return success_response(UnreadCountOut(count=NotificationRepository(db).count_unread(uid)))


@router.patch("/read", response_model=ApiResponse[NotificationMutationOut])
def mark_read(
    body: NotificationIdsIn, user: RequireMember, db: AppDb
) -> ApiResponse[NotificationMutationOut]:
    """선택(ids) 또는 전체(ids 없음) 읽음 처리."""
    uid = claims_user_id(user)
    repo = NotificationRepository(db)
    affected = repo.mark_read(uid, body.ids)
    db.commit()
    remaining = repo.count_unread(uid)
    # 행을 눌러 하나씩 읽는 경우가 훨씬 잦다 — 그때마다 토스트가 뜨면 시끄러우므로
    # "모두 읽음" 처럼 사용자가 명시적으로 일괄 처리했을 때만 알린다.
    message = "모든 알림을 읽음 처리했습니다." if body.ids is None and affected else ""
    return success_response(
        NotificationMutationOut(affected=affected, unread_count=remaining), message=message
    )


@router.delete("", response_model=ApiResponse[NotificationMutationOut])
def delete_notifications(
    body: NotificationIdsIn, user: RequireMember, db: AppDb
) -> ApiResponse[NotificationMutationOut]:
    """선택(ids) 또는 전체(ids 없음) 삭제.

    행을 지우지 않고 deleted_at 만 찍지만(soft delete) 클라이언트에게는 완전히 삭제로 보인다
    — 지운 알림은 목록·개수·커서 어디에도 다시 나오지 않는다.
    """
    uid = claims_user_id(user)
    repo = NotificationRepository(db)
    affected = repo.soft_delete(uid, body.ids)
    db.commit()
    remaining = repo.count_unread(uid)
    if body.ids is None:
        message = "모든 알림을 삭제했습니다." if affected else ""
    else:
        message = f"알림 {affected}개를 삭제했습니다." if affected else ""
    return success_response(
        NotificationMutationOut(affected=affected, unread_count=remaining), message=message
    )


def _out(row: Notification) -> NotificationOut:
    """응답 필드를 한곳에서 조립해 엔드포인트 사이 누락을 막는다."""
    return NotificationOut(
        id=row.id,
        type=row.type,
        title=row.title,
        content=row.content,
        resource_type=row.resource_type,
        resource_id=row.resource_id,
        read_at=row.read_at,
        created_at=row.created_at,
    )
