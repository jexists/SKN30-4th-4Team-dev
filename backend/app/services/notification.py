"""알림 생성.

**모든 함수는 절대 예외를 밖으로 내지 않는다(fail-soft).** 알림은 본 작업의 곁가지라,
여기서 실패했다고 이미 끝난 회원가입이나 분석을 되돌리거나 사용자에게 실패로 보여선 안 된다.

**호출 순서 규칙**: 본 작업(가입 커밋·작업 상태 커밋)이 끝난 **뒤에** 부른다. 이 함수들은
자기 INSERT 만 커밋하므로, 이 순서를 지키면 "알림은 왔는데 결과가 없다" 가 구조적으로
불가능해진다. 반대 방향(결과는 있는데 알림이 없다)은 일어날 수 있지만, 사용자는 목록에서
결과를 찾을 수 있으므로 훨씬 가벼운 고장이다.
"""

import logging
import uuid

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.models.notification import (
    WELCOME_CONTENT,
    WELCOME_DEDUPE_KEY,
    WELCOME_TITLE,
    NotificationType,
    ResourceType,
    analysis_dedupe_key,
)
from app.repositories.notification import NotificationRepository

logger = logging.getLogger(__name__)


def _create_once(
    db: Session,
    user_id: uuid.UUID,
    *,
    type: str,
    title: str,
    content: str,
    dedupe_key: str,
    resource_type: str | None = None,
    resource_id: uuid.UUID | None = None,
) -> bool:
    """알림을 dedupe_key 당 1건만 만든다. 만들었으면 True.

    중복은 두 겹으로 막는다 — 먼저 같은 키가 있는지 보고, 그 사이 다른 요청이 끼어들어도
    notification 의 부분 UNIQUE 인덱스(uq_notification_dedupe)가 IntegrityError 로 잡는다.
    """
    repo = NotificationRepository(db)
    try:
        if repo.exists_by_dedupe(user_id, dedupe_key):
            return False
        repo.add(
            user_id,
            type=type,
            title=title,
            content=content,
            resource_type=resource_type,
            resource_id=resource_id,
            dedupe_key=dedupe_key,
        )
        db.commit()
        return True
    except IntegrityError:
        # 동시에 들어온 다른 요청이 먼저 만들었다 — 중복 방지가 의도대로 동작한 것이라
        # 조용히 넘긴다.
        db.rollback()
        return False
    except SQLAlchemyError:
        logger.exception("알림 생성 실패 user_id=%s dedupe_key=%s", user_id, dedupe_key)
        db.rollback()
        return False


def create_welcome_notification(db: Session, user_id: uuid.UUID) -> bool:
    """가입 축하 알림을 회원당 1건만 만든다.

    이메일 가입은 DB 트리거(sql/auth_provisioning.sql)가, 카카오 가입은 가입 완료 API 가
    부른다. 두 경로가 동시에 돌 수 있어 애플리케이션 검사만으로는 부족하다.
    """
    return _create_once(
        db,
        user_id,
        type=NotificationType.WELCOME.value,
        title=WELCOME_TITLE,
        content=WELCOME_CONTENT,
        dedupe_key=WELCOME_DEDUPE_KEY,
    )


def _notify_analysis(
    db: Session,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    *,
    event: str,
    type: str,
    title: str,
    content: str,
) -> bool:
    return _create_once(
        db,
        user_id,
        type=type,
        title=title,
        content=content,
        dedupe_key=analysis_dedupe_key(job_id, event),
        resource_type=ResourceType.ANALYSIS_JOB.value,
        resource_id=job_id,
    )


def notify_analysis_started(db: Session, user_id: uuid.UUID, job_id: uuid.UUID) -> bool:
    return _notify_analysis(
        db,
        user_id,
        job_id,
        event="STARTED",
        type=NotificationType.ANALYSIS_STARTED.value,
        title="AI 분석을 시작했습니다.",
        content="분석이 완료되면 알림으로 알려드리겠습니다.",
    )


def notify_analysis_completed(db: Session, user_id: uuid.UUID, job_id: uuid.UUID) -> bool:
    return _notify_analysis(
        db,
        user_id,
        job_id,
        event="SUCCEEDED",
        type=NotificationType.ANALYSIS_COMPLETED.value,
        title="AI 분석이 완료되었습니다.",
        content="분석 결과를 확인해보세요.",
    )


def notify_analysis_failed(db: Session, user_id: uuid.UUID, job_id: uuid.UUID) -> bool:
    return _notify_analysis(
        db,
        user_id,
        job_id,
        event="FAILED",
        type=NotificationType.ANALYSIS_FAILED.value,
        title="AI 분석에 실패했습니다.",
        content="잠시 후 다시 시도해주세요.",
    )
