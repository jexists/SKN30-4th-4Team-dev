"""카카오 가입에 필요한 인증 Entity/Repository TDD."""

import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models.auth import AppUser, LoginHistory, Profile, UserAgreement
from app.repositories.auth import AuthRepository


@pytest.fixture()
def db() -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_repository_creates_complete_member_graph(db: Session):
    user_id = uuid.uuid4()
    repo = AuthRepository(db)

    assert repo.is_registered(user_id) is False

    repo.add_app_user(user_id)
    repo.upsert_profile(
        user_id,
        nickname="홈쉴드",
        profile_image="https://example.com/profile.png",
    )
    repo.set_agreement(user_id, "terms", "v1", True)
    repo.set_agreement(user_id, "privacy", "v1", True)
    repo.set_agreement(user_id, "marketing", "v1", False)
    repo.add_login_history(user_id, client_ip="127.0.0.1", device="pytest")
    db.commit()

    assert repo.is_registered(user_id) is True
    user = db.get(AppUser, user_id)
    assert user is not None
    assert user.username is None
    assert user.created_at is not None
    assert user.updated_at is not None

    profile = db.execute(select(Profile).where(Profile.user_id == user_id)).scalar_one()
    assert profile.nickname == "홈쉴드"
    assert profile.profile_image == "https://example.com/profile.png"

    agreements = (
        db.execute(
            select(UserAgreement)
            .where(UserAgreement.user_id == user_id)
            .order_by(UserAgreement.agreement_type)
        )
        .scalars()
        .all()
    )
    assert [(row.agreement_type, row.is_agreed) for row in agreements] == [
        ("marketing", False),
        ("privacy", True),
        ("terms", True),
    ]

    history = db.execute(select(LoginHistory).where(LoginHistory.user_id == user_id)).scalar_one()
    assert history.client_ip == "127.0.0.1"
    assert history.device == "pytest"
    assert history.login_at is not None


def test_profile_and_agreement_are_idempotent_upserts(db: Session):
    user_id = uuid.uuid4()
    repo = AuthRepository(db)
    repo.add_app_user(user_id)
    repo.upsert_profile(user_id, nickname="처음", profile_image=None)
    repo.set_agreement(user_id, "marketing", "v1", False)
    db.flush()

    repo.upsert_profile(user_id, nickname="변경", profile_image="https://example.com/new.png")
    repo.set_agreement(user_id, "marketing", "v1", True)
    db.commit()

    profiles = db.execute(select(Profile).where(Profile.user_id == user_id)).scalars().all()
    agreements = (
        db.execute(
            select(UserAgreement).where(
                UserAgreement.user_id == user_id,
                UserAgreement.agreement_type == "marketing",
                UserAgreement.version == "v1",
            )
        )
        .scalars()
        .all()
    )
    assert len(profiles) == 1
    assert profiles[0].nickname == "변경"
    assert len(agreements) == 1
    assert agreements[0].is_agreed is True
