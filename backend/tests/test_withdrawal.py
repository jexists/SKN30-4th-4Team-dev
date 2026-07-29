"""회원 탈퇴(Soft Delete) — Repository·API·차단 동작 TDD.

핵심 전제: 탈퇴는 행을 지우지 않는다. 그래서 '행이 없다'가 아니라 '탈퇴 표시가 있다'로
막아야 하고, Supabase auth.users 는 남아 있어 카카오 인증 자체는 계속 성공한다.
"""

import uuid
from datetime import UTC

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import require_user
from app.db.base import Base
from app.db.session import get_app_db
from app.main import app
from app.models.auth import AppUser
from app.models.chat import ChatRoom
from app.repositories.auth import AuthRepository


@pytest.fixture()
def member_client():
    """가입 완료 회원 + auth 스키마(세션·리프레시 토큰)까지 흉내 낸 TestClient."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(engine)

    user_id = uuid.uuid4()
    with engine.begin() as connection:
        connection.exec_driver_sql("ATTACH DATABASE ':memory:' AS auth")
        connection.exec_driver_sql("CREATE TABLE auth.users (id TEXT PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE auth.sessions (id TEXT PRIMARY KEY, user_id TEXT)")
        connection.exec_driver_sql(
            "CREATE TABLE auth.refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT)"
        )
        connection.execute(
            text("INSERT INTO auth.users (id) VALUES (:user_id)"),
            {"user_id": str(user_id)},
        )
        connection.execute(
            text("INSERT INTO auth.sessions (id, user_id) VALUES (:id, :user_id)"),
            {"id": str(uuid.uuid4()), "user_id": str(user_id)},
        )
        connection.execute(
            text("INSERT INTO auth.refresh_tokens (id, user_id) VALUES (:id, :user_id)"),
            {"id": str(uuid.uuid4()), "user_id": str(user_id)},
        )

    with SessionLocal() as db:
        repo = AuthRepository(db)
        repo.add_app_user(user_id)
        repo.upsert_profile(user_id, nickname="탈퇴회원", profile_image=None)
        repo.set_agreement(user_id, "terms", "v1", True)
        repo.set_agreement(user_id, "privacy", "v1", True)
        db.add(ChatRoom(user_id=user_id, title="탈퇴 후에도 남아야 하는 대화"))
        db.commit()

    def override_get_app_db():
        with SessionLocal() as db:
            yield db

    claims = {
        "sub": str(user_id),
        "email": "member@example.com",
        "app_metadata": {"provider": "kakao", "providers": ["kakao"]},
        "user_metadata": {"nickname": "탈퇴회원"},
    }
    app.dependency_overrides[get_app_db] = override_get_app_db
    app.dependency_overrides[require_user] = lambda: claims
    with TestClient(app) as client:
        yield client, SessionLocal, user_id
    app.dependency_overrides.clear()


# ── Repository ─────────────────────────────────────────────────────────


def test_soft_delete_marks_flag_and_timestamp_without_removing_row(member_client):
    _, SessionLocal, user_id = member_client

    with SessionLocal() as db:
        repo = AuthRepository(db)
        deleted_at = repo.soft_delete_user(user_id)
        db.commit()

        user = db.get(AppUser, user_id)
        assert user is not None  # 행은 그대로 남는다
        assert user.is_deleted is True
        # SQLite 는 tz 를 버리고 저장하므로 시각만 비교한다(Postgres 는 timestamptz).
        assert user.deleted_at is not None
        assert user.deleted_at.replace(tzinfo=UTC) == deleted_at


def test_withdrawn_user_is_neither_active_nor_registered(member_client):
    _, SessionLocal, user_id = member_client

    with SessionLocal() as db:
        repo = AuthRepository(db)
        assert repo.is_registered(user_id) is True

        repo.soft_delete_user(user_id)
        db.commit()

        assert repo.get_active_app_user(user_id) is None
        assert repo.is_registered(user_id) is False
        assert repo.is_withdrawn(user_id) is True


def test_never_registered_user_is_not_withdrawn(member_client):
    _, SessionLocal, _ = member_client

    with SessionLocal() as db:
        # '가입한 적 없음' 과 '탈퇴함' 은 다른 상태다 — 안내 문구가 갈린다.
        assert AuthRepository(db).is_withdrawn(uuid.uuid4()) is False


def test_legacy_row_with_only_deleted_at_is_treated_as_withdrawn(member_client):
    """is_deleted 도입 전 deleted_at 만 찍힌 행도 탈퇴로 본다."""
    _, SessionLocal, user_id = member_client

    with SessionLocal() as db:
        user = db.get(AppUser, user_id)
        assert user is not None
        user.deleted_at = user.created_at
        db.commit()

        assert AuthRepository(db).is_registered(user_id) is False


# ── API ────────────────────────────────────────────────────────────────


def test_withdraw_soft_deletes_and_revokes_refresh_tokens(member_client):
    client, SessionLocal, user_id = member_client

    response = client.delete("/api/v1/me")

    assert response.status_code == 200
    body = response.json()
    assert body["message"] == "회원 탈퇴가 완료되었습니다."
    assert body["data"]["id"] == str(user_id)
    assert body["data"]["deleted_at"] is not None

    with SessionLocal() as db:
        user = db.get(AppUser, user_id)
        assert user is not None
        assert user.is_deleted is True
        assert user.deleted_at is not None
        # 갱신 경로를 끊어 남은 세션으로 토큰을 계속 연장하지 못하게 한다.
        assert db.execute(text("SELECT count(*) FROM auth.refresh_tokens")).scalar_one() == 0
        assert db.execute(text("SELECT count(*) FROM auth.sessions")).scalar_one() == 0
        # Supabase 인증 행은 남는다(완전 삭제는 배치의 몫).
        assert db.execute(text("SELECT count(*) FROM auth.users")).scalar_one() == 1


def test_withdraw_keeps_chat_and_other_user_data(member_client):
    client, SessionLocal, user_id = member_client

    assert client.delete("/api/v1/me").status_code == 200

    with SessionLocal() as db:
        rooms = db.execute(select(ChatRoom).where(ChatRoom.user_id == user_id)).scalars().all()
        assert len(rooms) == 1
        assert rooms[0].deleted_at is None


def test_withdrawn_user_cannot_withdraw_twice(member_client):
    client, _, _ = member_client
    assert client.delete("/api/v1/me").status_code == 200

    response = client.delete("/api/v1/me")

    assert response.status_code == 403
    assert response.json()["error"]["title"] == "탈퇴한 계정"


def test_withdrawn_user_is_not_returned_by_me(member_client):
    client, _, _ = member_client
    assert client.get("/api/v1/me").status_code == 200

    assert client.delete("/api/v1/me").status_code == 200

    response = client.get("/api/v1/me")
    assert response.status_code == 403
    assert response.json()["error"]["title"] == "탈퇴한 계정"


def test_withdrawn_user_cannot_use_member_api(member_client):
    client, _, _ = member_client
    assert client.delete("/api/v1/me").status_code == 200

    response = client.get("/api/v1/chat/rooms")

    assert response.status_code == 403
    assert response.json()["error"]["title"] == "탈퇴한 계정"


def test_withdrawn_user_cannot_log_in_again(member_client):
    """탈퇴해도 auth.users 는 남아 카카오 인증은 성공한다 — 로그인은 여기서 막힌다."""
    client, _, _ = member_client
    assert client.delete("/api/v1/me").status_code == 200

    response = client.post("/api/v1/auth/kakao/login")

    assert response.status_code == 403
    error = response.json()["error"]
    assert error["title"] == "탈퇴한 계정"
    assert "새로 가입" in error["message"]


def test_registration_check_blocks_withdrawn_user_instead_of_asking_signup(member_client):
    client, _, _ = member_client
    assert client.delete("/api/v1/me").status_code == 200

    response = client.get("/api/v1/auth/registration")

    assert response.status_code == 403
    assert response.json()["error"]["title"] == "탈퇴한 계정"


def test_withdrawn_user_cannot_sign_up_again_with_same_identity(member_client):
    client, _, _ = member_client
    assert client.delete("/api/v1/me").status_code == 200

    response = client.post(
        "/api/v1/auth/signup",
        json={
            "nickname": "재가입",
            "agree_terms": True,
            "agree_privacy": True,
            "agree_marketing": False,
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["title"] == "탈퇴한 계정"


def test_withdraw_requires_registered_member(member_client):
    """JWT 만 유효하고 가입은 하지 않은 사용자는 탈퇴 대상이 아니다."""
    client, _, _ = member_client
    app.dependency_overrides[require_user] = lambda: {"sub": str(uuid.uuid4())}

    response = client.delete("/api/v1/me")

    assert response.status_code == 403
    assert response.json()["error"]["title"] == "회원가입 필요"
