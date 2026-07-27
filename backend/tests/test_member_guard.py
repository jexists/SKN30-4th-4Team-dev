"""JWT 인증과 앱 회원가입 완료를 분리하는 보호 API 테스트."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import require_user
from app.db.base import Base
from app.db.session import get_app_db
from app.main import app
from app.models.auth import AppUser, UserAgreement


@pytest.fixture()
def guarded_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(engine)
    user_id = uuid.uuid4()

    def override_get_app_db():
        with SessionLocal() as db:
            yield db

    app.dependency_overrides[get_app_db] = override_get_app_db
    app.dependency_overrides[require_user] = lambda: {"sub": str(user_id)}
    with TestClient(app) as client:
        yield client, SessionLocal, user_id
    app.dependency_overrides.clear()


def test_authenticated_but_unregistered_user_cannot_use_member_api(guarded_client):
    client, _, _ = guarded_client

    response = client.get("/api/v1/chat/rooms")

    assert response.status_code == 403
    assert response.json()["error"]["title"] == "회원가입 필요"


def test_registered_user_can_use_member_api(guarded_client):
    client, SessionLocal, user_id = guarded_client
    with SessionLocal() as db:
        db.add(AppUser(id=user_id))
        db.add_all(
            [
                UserAgreement(
                    user_id=user_id,
                    agreement_type="terms",
                    version="v1",
                    is_agreed=True,
                ),
                UserAgreement(
                    user_id=user_id,
                    agreement_type="privacy",
                    version="v1",
                    is_agreed=True,
                ),
            ]
        )
        db.commit()

    response = client.get("/api/v1/chat/rooms")

    assert response.status_code == 200
