"""notification 테이블 접근."""

import uuid
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import Select, func, select, update
from sqlalchemy.orm import Session

from app.models.auth import utcnow
from app.models.notification import Notification


class NotificationRepository:
    def __init__(self, db: Session):
        self.db = db

    def _alive(self, user_id: uuid.UUID) -> Select:
        """살아있는 내 알림만 담은 base select. **모든 조회가 여기서 출발한다.**

        user_id 와 deleted_at 필터를 한 곳에서만 관리해야 "지웠는데 다시 보인다"·"남의 알림이
        보인다" 가 구조적으로 막힌다. 새 조회 메서드를 추가할 때도 select() 를 직접 쓰지 말고
        이걸 쓴다.
        """
        return select(Notification).where(
            Notification.user_id == user_id,
            Notification.deleted_at.is_(None),
        )

    def exists_by_dedupe(self, user_id: uuid.UUID, dedupe_key: str) -> bool:
        """같은 사건의 알림이 이미 있는지.

        **일부러 _alive 를 쓰지 않는다** — 사용자가 지운 알림도 "이미 알렸다" 는 사실은
        그대로다. 지웠다고 가입 축하나 완료 알림을 다시 만들면 안 된다.
        """
        return (
            self.db.execute(
                select(Notification.id)
                .where(
                    Notification.user_id == user_id,
                    Notification.dedupe_key == dedupe_key,
                )
                .limit(1)
            ).first()
            is not None
        )

    def add(
        self,
        user_id: uuid.UUID,
        *,
        type: str,
        title: str,
        content: str,
        resource_type: str | None = None,
        resource_id: uuid.UUID | None = None,
        dedupe_key: str | None = None,
    ) -> Notification:
        notification = Notification(
            user_id=user_id,
            type=type,
            title=title,
            content=content,
            resource_type=resource_type,
            resource_id=resource_id,
            dedupe_key=dedupe_key,
        )
        self.db.add(notification)
        return notification

    def list_by_user(
        self,
        user_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[datetime, uuid.UUID] | None = None,
        unread_only: bool = False,
    ) -> tuple[list[Notification], bool]:
        """최신순 한 페이지와 "더 있는지" 를 돌려준다. 커서 인코딩은 라우터가 맡는다.

        unread 필터를 서버에서 하는 이유: 커서 페이지네이션과 클라이언트 필터를 섞으면
        "30개 받았는데 안읽음이 2개뿐" 인 빈 페이지가 생긴다.
        """
        stmt = self._alive(user_id)
        if unread_only:
            stmt = stmt.where(Notification.read_at.is_(None))
        stmt = stmt.order_by(Notification.created_at.desc(), Notification.id.desc())
        # +1 로 다음 페이지 존재 여부를 확인한다(별도 count 쿼리를 피한다).
        stmt = stmt.limit(limit + 1)
        if cursor is not None:
            c_ts, c_id = cursor
            stmt = stmt.where(
                (Notification.created_at < c_ts)
                | ((Notification.created_at == c_ts) & (Notification.id < c_id))
            )
        rows = list(self.db.execute(stmt).scalars().all())
        has_more = len(rows) > limit
        return rows[:limit], has_more

    def count_unread(self, user_id: uuid.UUID) -> int:
        stmt = select(func.count()).select_from(
            self._alive(user_id).where(Notification.read_at.is_(None)).subquery()
        )
        return int(self.db.execute(stmt).scalar_one())

    def mark_read(self, user_id: uuid.UUID, ids: Sequence[uuid.UUID] | None = None) -> int:
        """ids 가 None 이면 전체. 실제로 바뀐 건수를 돌려준다.

        `read_at IS NULL` 조건이 있어서 이미 읽은 알림에 "모두 읽음" 을 다시 눌러도 최초로
        읽은 시각이 덮이지 않는다.
        """
        return self._bulk_update(user_id, ids, {"read_at": utcnow()}, Notification.read_at)

    def soft_delete(self, user_id: uuid.UUID, ids: Sequence[uuid.UUID] | None = None) -> int:
        """ids 가 None 이면 전체. 행을 지우지 않고 deleted_at 만 찍는다."""
        return self._bulk_update(user_id, ids, {"deleted_at": utcnow()}, Notification.deleted_at)

    def _bulk_update(
        self,
        user_id: uuid.UUID,
        ids: Sequence[uuid.UUID] | None,
        values: dict[str, datetime],
        null_guard,
    ) -> int:
        # 빈 리스트는 "전체"가 아니라 "아무것도 아님"이다. None 과 반드시 구분한다 —
        # 섞으면 아무것도 선택하지 않은 사용자의 요청이 전체 삭제로 돌변한다.
        if ids is not None and not ids:
            return 0
        stmt = (
            update(Notification)
            .where(
                Notification.user_id == user_id,
                Notification.deleted_at.is_(None),
                null_guard.is_(None),
            )
            .values(**values)
        )
        if ids is not None:
            stmt = stmt.where(Notification.id.in_(ids))
        result = self.db.execute(stmt.execution_options(synchronize_session=False))
        return int(result.rowcount or 0)
