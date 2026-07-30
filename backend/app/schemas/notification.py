"""알림 API 입출력. DB 모델은 models/notification.py."""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class NotificationOut(BaseModel):
    """알림 한 건.

    `is_read` 불리언을 따로 내려보내지 않는다 — 프론트가 `read_at !== null` 로 파생한다.
    같은 사실을 두 필드로 내보내면 소비자가 어느 쪽을 믿을지 헷갈린다.
    `deleted_at` 도 넣지 않는다: 지운 알림은 애초에 조회되지 않아 항상 null 이라 의미가 없다.
    """

    id: uuid.UUID
    type: str
    title: str
    content: str
    # 클릭 시 이동할 대상. 완성된 URL 대신 종류+id 만 준다 — 경로는 프론트가 만든다.
    resource_type: str | None = None
    resource_id: uuid.UUID | None = None
    read_at: datetime | None = None
    created_at: datetime


class UnreadCountOut(BaseModel):
    count: int


class NotificationIdsIn(BaseModel):
    """선택/전체 공용 입력. **ids 가 None(또는 생략)이면 전체가 대상**이다.

    선택과 전체를 엔드포인트 두 개로 나누지 않은 이유: 서버·프론트 양쪽에서 분기가 하나로
    줄고, 단건 처리도 ids=[하나] 로 자연스럽게 표현된다.
    """

    ids: list[uuid.UUID] | None = Field(
        default=None,
        # 한 번에 너무 많은 id 를 받아 쿼리가 비대해지지 않게 상한을 둔다.
        # 전체 대상 작업은 ids 를 비워 보내면 되므로 이 상한이 기능을 제한하지 않는다.
        max_length=200,
    )


class NotificationMutationOut(BaseModel):
    """읽음/삭제 처리 결과. 실제로 바뀐 건수를 돌려줘 프론트가 낙관적 갱신을 맞출 수 있다."""

    affected: int
    unread_count: int
