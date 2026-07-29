"""회원가입 축하 알림 TDD — 카카오 가입 API·이메일 트리거 SQL 양쪽."""

import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.notification import WELCOME_CONTENT, WELCOME_TITLE, Notification
from app.repositories.auth import AuthRepository
from app.services.notification import create_welcome_notification


@pytest.fixture()
def session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def _member(session_factory) -> uuid.UUID:
    """알림의 user_id 는 app_user 를 참조하므로 회원 행을 먼저 만든다."""
    user_id = uuid.uuid4()
    with session_factory() as db:
        AuthRepository(db).add_app_user(user_id)
        db.commit()
    return user_id


def test_creates_welcome_notification_with_required_columns(session_factory):
    user_id = _member(session_factory)

    with session_factory() as db:
        assert create_welcome_notification(db, user_id) is True

    with session_factory() as db:
        notification = db.execute(select(Notification)).scalar_one()
        assert notification.user_id == user_id
        assert notification.title == WELCOME_TITLE
        assert notification.content == WELCOME_CONTENT
        assert notification.is_read is False
        assert notification.created_at is not None


def test_does_not_create_twice_for_same_user(session_factory):
    user_id = _member(session_factory)

    with session_factory() as db:
        assert create_welcome_notification(db, user_id) is True
    with session_factory() as db:
        assert create_welcome_notification(db, user_id) is False

    with session_factory() as db:
        assert len(db.execute(select(Notification)).scalars().all()) == 1


def test_unique_index_blocks_duplicate_that_slips_past_the_check(session_factory):
    """검사와 INSERT 사이에 다른 요청이 끼어들어도 DB 제약이 막는다."""
    user_id = _member(session_factory)

    with session_factory() as db:
        create_welcome_notification(db, user_id)

    with session_factory() as db:
        db.add(Notification(user_id=user_id, title=WELCOME_TITLE, content=WELCOME_CONTENT))
        with pytest.raises(SQLAlchemyError):
            db.commit()


def test_failure_is_swallowed_so_signup_never_fails(session_factory, monkeypatch):
    """알림 생성이 터져도 예외가 밖으로 새지 않는다 — 가입은 이미 커밋됐다."""
    user_id = _member(session_factory)

    def boom(*args, **kwargs):
        raise SQLAlchemyError("DB down")

    monkeypatch.setattr(
        "app.repositories.notification.NotificationRepository.exists_by_title", boom
    )

    with session_factory() as db:
        assert create_welcome_notification(db, user_id) is False


def test_kakao_signup_api_creates_welcome_notification(kakao_client):
    """카카오 가입은 백엔드를 거치므로 가입 완료 API 가 알림을 만든다."""
    client, SessionLocal, claims = kakao_client

    response = client.post(
        "/api/v1/auth/signup",
        json={
            "nickname": "새회원",
            "agree_terms": True,
            "agree_privacy": True,
            "agree_marketing": False,
        },
    )

    assert response.status_code == 201
    with SessionLocal() as db:
        notification = db.execute(select(Notification)).scalar_one()
        assert notification.user_id == uuid.UUID(claims["sub"])
        assert notification.title == WELCOME_TITLE
        assert notification.content == WELCOME_CONTENT
        assert notification.is_read is False


def test_kakao_signup_succeeds_even_if_notification_fails(kakao_client, monkeypatch):
    """알림 생성이 실패해도 회원가입은 201 로 성공해야 한다."""
    client, SessionLocal, claims = kakao_client

    def boom(*args, **kwargs):
        raise SQLAlchemyError("DB down")

    monkeypatch.setattr(
        "app.repositories.notification.NotificationRepository.exists_by_title", boom
    )

    response = client.post(
        "/api/v1/auth/signup",
        json={
            "nickname": "새회원",
            "agree_terms": True,
            "agree_privacy": True,
            "agree_marketing": False,
        },
    )

    assert response.status_code == 201
    with SessionLocal() as db:
        # 가입은 남고 알림만 없다.
        assert db.execute(select(Notification)).scalars().all() == []
        assert AuthRepository(db).is_registered(uuid.UUID(claims["sub"])) is True


def test_email_signup_trigger_creates_welcome_notification():
    """이메일 가입은 백엔드를 거치지 않으므로 트리거가 알림을 만들어야 한다."""
    sql = Path("sql/auth_provisioning.sql").read_text(encoding="utf-8").lower()

    assert "insert into public.notification" in sql
    assert "회원가입을 축하합니다." in sql
    assert "ai 분석으로 안전한 계약을 시작해보세요." in sql
    # 카카오 식별자는 위에서 return 하므로 알림 INSERT 까지 내려오지 않는다.
    provider_guard = "new.raw_app_meta_data->>'provider' = 'kakao'"
    assert sql.index(provider_guard) < sql.index("insert into public.notification")


def test_schema_has_welcome_dedupe_index():
    sql = Path("sql/schema.sql").read_text(encoding="utf-8").lower()

    assert "uq_notification_welcome" in sql
    assert "회원가입을 축하합니다." in sql
