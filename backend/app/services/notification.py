"""알림 생성 — 지금은 가입 축하 알림 하나뿐이다."""

import logging
import uuid

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.notification import WELCOME_CONTENT, WELCOME_TITLE
from app.repositories.notification import NotificationRepository

logger = logging.getLogger(__name__)


def create_welcome_notification(db: Session, user_id: uuid.UUID) -> bool:
    """가입 축하 알림을 회원당 1건만 만든다. 만들었으면 True.

    **절대 예외를 밖으로 내지 않는다.** 알림은 가입의 곁가지라, 여기서 실패했다고 이미 끝난
    회원가입을 되돌리거나 사용자에게 실패로 보여선 안 된다. 호출부는 가입 커밋이 끝난 뒤에
    부르고, 이 함수는 자기 INSERT 만 커밋한다(실패 시 rollback 해도 가입은 이미 커밋 완료).

    중복은 두 겹으로 막는다 — 먼저 같은 제목이 있는지 보고, 그 사이 다른 요청이 끼어들어도
    notification 의 부분 UNIQUE 인덱스(uq_notification_welcome)가 IntegrityError 로 잡는다.
    """
    repo = NotificationRepository(db)
    try:
        if repo.exists_by_title(user_id, WELCOME_TITLE):
            return False
        repo.add(user_id, WELCOME_TITLE, WELCOME_CONTENT)
        db.commit()
        return True
    except IntegrityError:
        # 동시에 들어온 다른 요청이 먼저 만들었다 — 중복 방지가 의도대로
        # 동작한 것이라 조용히 넘긴다.
        db.rollback()
        return False
    except SQLAlchemyError:
        logger.exception("가입 축하 알림 생성 실패 user_id=%s", user_id)
        db.rollback()
        return False
