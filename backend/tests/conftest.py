import uuid
from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import require_user
from app.core.config import settings
from app.db.base import Base
from app.db.session import get_app_db, get_db
from app.main import app
from app.repositories.auth import AGREEMENT_VERSION, AuthRepository


@pytest.fixture(scope="session", autouse=True)
def _no_startup_warmup():
    """테스트 내내 기동 워밍업과 분석 워커를 끈다.

    워밍업: KURE-v1 ~2GB 다운로드·오프라인 CI 실패 방지.
    분석 워커: 켜두면 테스트마다 폴링 스레드가 뜨고, 격리 DB 가 아니라 실제 APP_DB_URL 을
    본다. 워커 자체는 tests/test_analysis_worker.py 가 자기 인스턴스를 만들어 검증한다.

    client 픽스처가 `with TestClient(app)` 로 테스트마다 lifespan 을 실행하므로, 끄지 않으면
    위 초기화가 테스트 수만큼 시도된다. settings 는 lru_cache 싱글턴이고 app.main import 시점에
    이미 만들어져 있어 환경변수를 나중에 바꿔도 반영되지 않는다 → 속성을 직접 바꾼다
    (test_auth.py 의 monkeypatch.setattr(config.settings, ...) 와 같은 방식).
    """
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(settings, "WARMUP_ON_STARTUP", False)
        mp.setattr(settings, "ANALYSIS_WORKER_ENABLED", False)
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
def kakao_client():
    """카카오 클레임으로 인증된 TestClient + 격리 DB.

    가입 완료 API 를 태우는 테스트가 여러 파일에 걸쳐 있어(test_kakao_auth,
    test_welcome_notification) 여기 둔다. auth.users 를 ATTACH 로 흉내내는 이유는
    가입 취소(pending 삭제)가 그 테이블을 지우기 때문이다.
    """
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
    with engine.begin() as connection:
        connection.exec_driver_sql("ATTACH DATABASE ':memory:' AS auth")
        connection.exec_driver_sql("CREATE TABLE auth.users (id TEXT PRIMARY KEY)")
        connection.execute(
            text("INSERT INTO auth.users (id) VALUES (:user_id)"),
            {"user_id": str(user_id)},
        )

    app.dependency_overrides[get_app_db] = override_get_app_db
    app.dependency_overrides[require_user] = lambda: claims
    with TestClient(app) as client:
        yield client, TestingSessionLocal, claims
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
