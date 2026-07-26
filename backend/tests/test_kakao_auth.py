"""카카오 회원 상태 확인과 가입 완료 API TDD."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import require_user
from app.db.base import Base
from app.db.session import get_app_db
from app.main import app
from app.models.auth import AppUser, LoginHistory, Profile, UserAgreement
from app.repositories.auth import AuthRepository


@pytest.fixture()
def kakao_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(engine)

    def override_get_app_db():
        with TestingSessionLocal() as db:
            yield db

    user_id = uuid.uuid4()
    claims = {
        "sub": str(user_id),
        "email": None,
        "app_metadata": {"provider": "kakao", "providers": ["kakao"]},
        "user_metadata": {
            "nickname": "카카오닉",
            "avatar_url": "https://example.com/kakao.png",
        },
    }

    app.dependency_overrides[get_app_db] = override_get_app_db
    app.dependency_overrides[require_user] = lambda: claims
    with TestClient(app) as client:
        yield client, TestingSessionLocal, claims
    app.dependency_overrides.clear()


def test_registration_says_signup_required_without_app_user(kakao_client):
    client, _, _ = kakao_client

    response = client.get("/api/v1/auth/registration")

    assert response.status_code == 200
    assert response.json()["data"] == {"status": "signup_required"}


def test_kakao_login_returns_signup_required_for_new_identity(kakao_client):
    client, SessionLocal, _ = kakao_client

    response = client.post(
        "/api/v1/auth/kakao/login",
        headers={"User-Agent": "pytest-browser"},
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["status"] == "signup_required"
    assert data["user"]["email"] is None
    assert data["user"]["nickname"] == "카카오닉"
    with SessionLocal() as db:
        assert db.execute(select(LoginHistory)).scalars().all() == []


def test_kakao_login_existing_member_records_history(kakao_client):
    client, SessionLocal, claims = kakao_client
    user_id = uuid.UUID(claims["sub"])
    with SessionLocal() as db:
        repo = AuthRepository(db)
        repo.add_app_user(user_id)
        repo.upsert_profile(user_id, nickname="가입닉", profile_image=None)
        db.commit()

    response = client.post(
        "/api/v1/auth/kakao/login",
        headers={"User-Agent": "pytest-browser"},
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "authenticated"
    with SessionLocal() as db:
        history = db.execute(select(LoginHistory)).scalar_one()
        assert history.device == "pytest-browser"


def test_kakao_login_rejects_non_kakao_provider(kakao_client):
    client, _, claims = kakao_client
    claims["app_metadata"] = {"provider": "email", "providers": ["email"]}

    response = client.post("/api/v1/auth/kakao/login")

    assert response.status_code == 403
    assert response.json()["error"]["title"] == "카카오 인증 오류"


def test_signup_requires_both_required_agreements(kakao_client):
    client, _, _ = kakao_client

    response = client.post(
        "/api/v1/auth/signup",
        json={
            "nickname": "새회원",
            "agree_terms": False,
            "agree_privacy": True,
            "agree_marketing": False,
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["title"] == "입력값 오류"


def test_signup_creates_member_profile_agreements_and_history(kakao_client):
    client, SessionLocal, claims = kakao_client
    user_id = uuid.UUID(claims["sub"])

    response = client.post(
        "/api/v1/auth/signup",
        json={
            "nickname": "  새회원  ",
            "agree_terms": True,
            "agree_privacy": True,
            "agree_marketing": False,
        },
        headers={"User-Agent": "signup-browser"},
    )

    assert response.status_code == 201
    data = response.json()["data"]
    assert data["status"] == "authenticated"
    assert data["user"]["id"] == str(user_id)
    assert data["user"]["nickname"] == "새회원"
    assert data["user"]["email"] is None

    with SessionLocal() as db:
        user = db.get(AppUser, user_id)
        assert user is not None
        assert user.username is None
        profile = db.execute(select(Profile)).scalar_one()
        assert profile.nickname == "새회원"
        assert profile.profile_image == "https://example.com/kakao.png"
        agreements = db.execute(select(UserAgreement)).scalars().all()
        assert {(row.agreement_type, row.version, row.is_agreed) for row in agreements} == {
            ("terms", "v1", True),
            ("privacy", "v1", True),
            ("marketing", "v1", False),
        }
        assert db.execute(select(LoginHistory)).scalar_one().device == "signup-browser"


def test_signup_uses_kakao_nickname_when_input_is_empty(kakao_client):
    client, _, _ = kakao_client

    response = client.post(
        "/api/v1/auth/signup",
        json={
            "nickname": " ",
            "agree_terms": True,
            "agree_privacy": True,
            "agree_marketing": True,
        },
    )

    assert response.status_code == 201
    assert response.json()["data"]["user"]["nickname"] == "카카오닉"


def test_signup_rejects_already_registered_member(kakao_client):
    client, _, _ = kakao_client
    body = {
        "nickname": "회원",
        "agree_terms": True,
        "agree_privacy": True,
        "agree_marketing": False,
    }
    assert client.post("/api/v1/auth/signup", json=body).status_code == 201

    response = client.post("/api/v1/auth/signup", json=body)

    assert response.status_code == 409
    assert response.json()["error"]["title"] == "이미 가입된 회원"
