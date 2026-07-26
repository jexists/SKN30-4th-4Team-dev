"""카카오 가입 트랜잭션 실패 시 rollback 회귀 테스트."""

import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.db.base import Base
from app.models.auth import AppUser, LoginHistory, Profile, UserAgreement
from app.repositories.auth import AuthRepository
from app.schemas.kakao_auth import KakaoSignUpRequest
from app.services.kakao_auth import complete_kakao_signup


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_signup_rolls_back_every_table_when_db_write_fails(db: Session, monkeypatch):
    user_id = uuid.uuid4()
    claims = {
        "sub": str(user_id),
        "app_metadata": {"provider": "kakao", "providers": ["kakao"]},
        "user_metadata": {"nickname": "카카오닉"},
    }
    body = KakaoSignUpRequest(
        nickname="신규",
        agree_terms=True,
        agree_privacy=True,
        agree_marketing=False,
    )
    original = AuthRepository.set_agreement

    def fail_on_privacy(self, uid, agreement_type, version, is_agreed):
        if agreement_type == "privacy":
            raise OperationalError("insert agreement", {}, RuntimeError("db down"))
        return original(self, uid, agreement_type, version, is_agreed)

    monkeypatch.setattr(AuthRepository, "set_agreement", fail_on_privacy)

    with pytest.raises(AppError) as raised:
        complete_kakao_signup(
            claims,
            body,
            db,
            client_ip="127.0.0.1",
            device="pytest",
        )

    assert raised.value.code == 500
    assert db.execute(select(AppUser)).scalars().all() == []
    assert db.execute(select(Profile)).scalars().all() == []
    assert db.execute(select(UserAgreement)).scalars().all() == []
    assert db.execute(select(LoginHistory)).scalars().all() == []
