import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_app_db, get_db
from app.main import app
from app.repositories.auth import AGREEMENT_VERSION, AuthRepository


@pytest.fixture(scope="session", autouse=True)
def _no_startup_warmup():
    """테스트 내내 기동 워밍업을 끈다 (KURE-v1 ~2GB 다운로드·오프라인 CI 실패 방지).

    client 픽스처가 `with TestClient(app)` 로 테스트마다 lifespan 을 실행하므로, 끄지 않으면
    모델 로드가 테스트 수만큼 시도된다. settings 는 lru_cache 싱글턴이고 app.main import 시점에
    이미 만들어져 있어 환경변수를 나중에 바꿔도 반영되지 않는다 → 속성을 직접 바꾼다
    (test_auth.py 의 monkeypatch.setattr(config.settings, ...) 와 같은 방식).
    """
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WARMUP_ON_STARTUP", False)
        yield


@pytest.fixture()
def db_sessionmaker():
    """테스트마다 새로 만드는 격리된 인메모리 SQLite 세션 팩토리."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture()
def client(db_sessionmaker):
    """격리된 인메모리 SQLite DB + get_db/get_app_db 오버라이드를 적용한 TestClient."""

    def override_get_db():
        db = db_sessionmaker()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    # 회원 가드(RequireMember)가 붙은 라우트(/me 등)도 같은 DB 를 보게 한다.
    # 오버라이드하지 않으면 APP_DB_URL 미설정 로컬에서 503 이 나 인증 테스트가 가려진다.
    app.dependency_overrides[get_app_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def register_member(db_sessionmaker) -> Callable[[uuid.UUID], uuid.UUID]:
    """가입 완료(app_user + 필수 약관) 상태의 회원을 만들어 준다."""

    def _register(user_id: uuid.UUID | None = None) -> uuid.UUID:
        user_id = user_id or uuid.uuid4()
        with db_sessionmaker() as db:
            repo = AuthRepository(db)
            repo.add_app_user(user_id)
            repo.set_agreement(user_id, "terms", AGREEMENT_VERSION, True)
            repo.set_agreement(user_id, "privacy", AGREEMENT_VERSION, True)
            db.commit()
        return user_id

    return _register
