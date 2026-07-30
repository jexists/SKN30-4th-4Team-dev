"""NotificationRepository — 커서 페이지네이션·unread 필터·선택/전체 읽음·soft delete."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.notification import (
    WELCOME_DEDUPE_KEY,
    Notification,
    NotificationType,
)
from app.repositories.auth import AuthRepository
from app.repositories.notification import NotificationRepository
from app.services.notification import create_welcome_notification

BASE_TIME = datetime(2026, 7, 30, 12, 0, tzinfo=UTC)


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture()
def user(session_factory) -> uuid.UUID:
    user_id = uuid.uuid4()
    with session_factory() as db:
        AuthRepository(db).add_app_user(user_id)
        db.commit()
    return user_id


@pytest.fixture()
def other_user(session_factory) -> uuid.UUID:
    user_id = uuid.uuid4()
    with session_factory() as db:
        AuthRepository(db).add_app_user(user_id)
        db.commit()
    return user_id


def _seed(session_factory, user_id: uuid.UUID, count: int, *, same_time: bool = False):
    """최신순으로 n-1 … 0 이 되도록 만든다(created_at 이 클수록 최신)."""
    made: list[Notification] = []
    with session_factory() as db:
        for i in range(count):
            row = Notification(
                user_id=user_id,
                type=NotificationType.GENERAL.value,
                title=f"알림 {i}",
                content="본문",
                created_at=BASE_TIME if same_time else BASE_TIME + timedelta(minutes=i),
            )
            db.add(row)
            made.append(row)
        db.commit()
        for row in made:
            db.refresh(row)
    return made


def test_list_paginates_by_cursor_newest_first(session_factory, user):
    _seed(session_factory, user, 5)

    with session_factory() as db:
        repo = NotificationRepository(db)
        page1, has_more = repo.list_by_user(user, limit=2)
        assert [n.title for n in page1] == ["알림 4", "알림 3"]
        assert has_more is True

        cursor = (page1[-1].created_at, page1[-1].id)
        page2, has_more = repo.list_by_user(user, limit=2, cursor=cursor)
        assert [n.title for n in page2] == ["알림 2", "알림 1"]
        assert has_more is True

        cursor = (page2[-1].created_at, page2[-1].id)
        page3, has_more = repo.list_by_user(user, limit=2, cursor=cursor)
        assert [n.title for n in page3] == ["알림 0"]
        assert has_more is False


def test_cursor_survives_identical_created_at(session_factory, user):
    """DB 트리거와 앱이 같은 시각에 만든 알림이 페이지 경계에서 유실·중복되면 안 된다."""
    _seed(session_factory, user, 6, same_time=True)

    seen: list[uuid.UUID] = []
    cursor = None
    with session_factory() as db:
        repo = NotificationRepository(db)
        while True:
            rows, has_more = repo.list_by_user(user, limit=2, cursor=cursor)
            seen.extend(row.id for row in rows)
            if not has_more:
                break
            cursor = (rows[-1].created_at, rows[-1].id)

    assert len(seen) == 6, "타이 때문에 행이 유실됐다"
    assert len(set(seen)) == 6, "타이 때문에 행이 중복됐다"


def test_unread_filter_and_count(session_factory, user):
    rows = _seed(session_factory, user, 3)

    with session_factory() as db:
        repo = NotificationRepository(db)
        assert repo.count_unread(user) == 3
        assert repo.mark_read(user, [rows[0].id]) == 1
        db.commit()

    with session_factory() as db:
        repo = NotificationRepository(db)
        assert repo.count_unread(user) == 2
        unread, _ = repo.list_by_user(user, limit=10, unread_only=True)
        assert [n.title for n in unread] == ["알림 2", "알림 1"]


def test_mark_read_does_not_overwrite_first_read_time(session_factory, user):
    rows = _seed(session_factory, user, 1)

    with session_factory() as db:
        NotificationRepository(db).mark_read(user, [rows[0].id])
        db.commit()
    with session_factory() as db:
        first = db.execute(select(Notification)).scalar_one().read_at

    with session_factory() as db:
        # 두 번째 "모두 읽음" 은 이미 읽은 행을 건드리지 않는다.
        assert NotificationRepository(db).mark_read(user) == 0
        db.commit()
    with session_factory() as db:
        assert db.execute(select(Notification)).scalar_one().read_at == first


def test_none_means_all_but_empty_list_means_nothing(session_factory, user):
    """ids=[] 를 "전체"로 취급하면 아무것도 선택 안 한 요청이 전체 삭제로 돌변한다."""
    _seed(session_factory, user, 3)

    with session_factory() as db:
        repo = NotificationRepository(db)
        assert repo.soft_delete(user, []) == 0
        db.commit()
    with session_factory() as db:
        assert NotificationRepository(db).count_unread(user) == 3

    with session_factory() as db:
        assert NotificationRepository(db).soft_delete(user) == 3
        db.commit()
    with session_factory() as db:
        assert NotificationRepository(db).count_unread(user) == 0


def test_soft_deleted_rows_disappear_from_every_read_path(session_factory, user):
    rows = _seed(session_factory, user, 3)

    with session_factory() as db:
        assert NotificationRepository(db).soft_delete(user, [rows[2].id]) == 1
        db.commit()

    with session_factory() as db:
        repo = NotificationRepository(db)
        listed, _ = repo.list_by_user(user, limit=10)
        assert [n.title for n in listed] == ["알림 1", "알림 0"]
        assert repo.count_unread(user) == 2
        unread, _ = repo.list_by_user(user, limit=10, unread_only=True)
        assert [n.title for n in unread] == ["알림 1", "알림 0"]

    with session_factory() as db:
        # 행 자체는 남아 있어야 한다 — soft delete 이므로.
        assert len(db.execute(select(Notification)).scalars().all()) == 3


def test_other_users_ids_are_silently_ignored(session_factory, user, other_user):
    mine = _seed(session_factory, user, 1)
    theirs = _seed(session_factory, other_user, 1)

    with session_factory() as db:
        repo = NotificationRepository(db)
        # 남의 id 를 섞어 보내도 내 것만 처리된다.
        assert repo.mark_read(user, [mine[0].id, theirs[0].id]) == 1
        assert repo.soft_delete(user, [theirs[0].id]) == 0
        db.commit()

    with session_factory() as db:
        assert NotificationRepository(db).count_unread(other_user) == 1
        listed, _ = NotificationRepository(db).list_by_user(other_user, limit=10)
        assert len(listed) == 1


def test_all_operations_are_scoped_to_owner(session_factory, user, other_user):
    _seed(session_factory, user, 2)
    _seed(session_factory, other_user, 3)

    with session_factory() as db:
        repo = NotificationRepository(db)
        listed, _ = repo.list_by_user(user, limit=10)
        assert len(listed) == 2
        assert repo.count_unread(user) == 2
        # 전체 읽음도 내 것만.
        assert repo.mark_read(user) == 2
        db.commit()

    with session_factory() as db:
        assert NotificationRepository(db).count_unread(other_user) == 3


def test_deleted_welcome_notification_is_not_recreated(session_factory, user):
    """지웠다고 같은 사건을 다시 알리면 안 된다 — exists_by_dedupe 는 지운 행도 본다."""
    with session_factory() as db:
        assert create_welcome_notification(db, user) is True
    with session_factory() as db:
        assert NotificationRepository(db).soft_delete(user) == 1
        db.commit()

    with session_factory() as db:
        assert create_welcome_notification(db, user) is False

    with session_factory() as db:
        rows = (
            db.execute(select(Notification).where(Notification.dedupe_key == WELCOME_DEDUPE_KEY))
            .scalars()
            .all()
        )
        assert len(rows) == 1
