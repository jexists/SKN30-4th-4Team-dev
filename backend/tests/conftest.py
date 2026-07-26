import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.main import app


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
def client():
    """격리된 인메모리 SQLite DB + get_db 오버라이드를 적용한 TestClient."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
