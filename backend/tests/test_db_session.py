"""app/db/session.py — 엔진 통합과 커넥션 풀 예산 회귀 방지.

엔진이 다시 두 벌로 갈라지거나 풀 상한이 기본값(5+10)으로 돌아가면 Supabase pooler 슬롯을
프로세스 하나가 2배로 먹는다(EMAXCONNSESSION). 그 회귀를 여기서 잡는다.
"""

import importlib

import pytest
from sqlalchemy.pool import QueuePool

from app.core.config import settings
from app.core.exceptions import AppError

# 실제로 연결하지 않는다 — create_engine 은 lazy 라 URL 형식만 맞으면 된다.
PG_URL = "postgresql+psycopg://user:pw@db.example.com:6543/postgres"
SQLITE_URL = "sqlite:///./test-only.db"


@pytest.fixture()
def reload_session():
    """APP_DB_URL 을 바꿔 app.db.session 을 다시 import 한다.

    엔진·풀은 모듈 import 시점에 만들어지므로 reload 없이는 분기를 검증할 수 없다.
    teardown 에서 원래 설정으로 되돌려 다른 테스트에 엉뚱한 엔진이 새지 않게 한다.
    """
    import app.db.session as session_module

    def _reload(url: str):
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(settings, "APP_DB_URL", url)
            return importlib.reload(session_module)

    yield _reload
    importlib.reload(session_module)


# ── Postgres ────────────────────────────────────────────────────────
def test_postgres_uses_single_engine(reload_session):
    """앱 데이터 엔진은 별도 풀이 아니라 같은 엔진이어야 한다."""
    m = reload_session(PG_URL)
    assert m.app_engine is m.engine
    assert m.AppSessionLocal is m.SessionLocal


def test_postgres_pool_budget_is_explicit(reload_session):
    """풀 상한이 SQLAlchemy 기본값(5+10)이 아니라 설정값으로 묶여 있어야 한다.

    검증 대상은 create_engine 에 넘기는 인자(_pool_kwargs)다. SQLAlchemy 내부 속성
    (pool._max_overflow 등)은 비공개라 버전이 올라가면 조용히 깨진다.
    """
    m = reload_session(PG_URL)
    assert m._pool_kwargs == {
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_timeout": settings.DB_POOL_TIMEOUT_SECONDS,
        "pool_recycle": settings.DB_POOL_RECYCLE_SECONDS,
        "pool_pre_ping": True,
    }
    # 인자가 실제 엔진에 반영됐는지는 공개 API 로 확인한다.
    assert isinstance(m.engine.pool, QueuePool)
    assert m.engine.pool.size() == settings.DB_POOL_SIZE
    # 프로세스당 상한 = pool_size + max_overflow. 예산 계산의 근거값.
    assert settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW <= 10


def test_postgres_disables_prepared_statements(reload_session):
    """Supavisor transaction mode(:6543) 는 named prepared statement 를 지원하지 않는다."""
    m = reload_session(PG_URL)
    assert m._connect_args["prepare_threshold"] is None
    assert m._connect_args["connect_timeout"] == settings.DB_CONNECT_TIMEOUT_SECONDS
    assert m._connect_args["application_name"] == "skn30-backend"


def test_postgres_url_is_normalized_to_psycopg3(reload_session):
    """psycopg2 미설치 — postgresql:// 로 줘도 psycopg3 드라이버로 정규화돼야 한다."""
    m = reload_session("postgresql://user:pw@db.example.com:6543/postgres")
    assert m.engine.url.drivername == "postgresql+psycopg"


# ── SQLite 폴백 ──────────────────────────────────────────────────────
def test_sqlite_disables_app_db(reload_session):
    """SQLite 면 대화 기록 저장소가 없다 — get_app_db 는 503 (기존 계약)."""
    m = reload_session(SQLITE_URL)
    assert m.app_engine is None
    assert m.AppSessionLocal is None

    with pytest.raises(AppError) as exc:
        next(m.get_app_db())
    assert exc.value.code == 503


def test_sqlite_skips_queuepool_options(reload_session):
    """QueuePool 전용 옵션을 SQLite 엔진에 넘기면 기동이 깨진다."""
    m = reload_session(SQLITE_URL)
    assert m._pool_kwargs == {}
    assert m._connect_args == {"check_same_thread": False}
