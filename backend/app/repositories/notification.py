"""notification 테이블 접근."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.notification import Notification


class NotificationRepository:
    def __init__(self, db: Session):
        self.db = db

    def exists_by_title(self, user_id: uuid.UUID, title: str) -> bool:
        """같은 제목의 알림이 이미 있는지. 가입 축하 알림 중복 생성을 막는 데 쓴다."""
        return (
            self.db.execute(
                select(Notification.id)
                .where(Notification.user_id == user_id, Notification.title == title)
                .limit(1)
            ).first()
            is not None
        )

    def add(self, user_id: uuid.UUID, title: str, content: str) -> Notification:
        notification = Notification(user_id=user_id, title=title, content=content)
        self.db.add(notification)
        return notification
