"""DB 엔진·세션.

⚠️ 엔진은 **하나만** 만든다. 예전에는 스켈레톤용 engine 과 앱 데이터용 app_engine 을 따로
두었는데, 운영에서는 둘 다 같은 Supabase 를 가리키면서 풀만 두 벌이 되어 프로세스 하나가
pooler 슬롯을 2배로 먹었다(EMAXCONNSESSION 의 직접 원인). 새 엔진을 추가하지 말 것.

연결 예산은 app.core.config 의 DB_POOL_* 참고 — 프로세스당 상한을 명시적으로 잡는다.
"""

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.exceptions import AppError

if settings.is_sqlite:
    # SQLite 폴백(로컬·테스트). 풀 옵션은 QueuePool 전용이라 넘기면 안 된다.
    _connect_args: dict = {"check_same_thread": False}
    _pool_kwargs: dict = {}
else:
    _connect_args = {
        # Supavisor transaction mode(:6543) 는 named prepared statement 를 지원하지 않는다.
        # psycopg3 는 같은 쿼리를 5회 실행하면 자동으로 prepare 하므로 반드시 꺼야 한다.
        "prepare_threshold": None,
        "connect_timeout": settings.DB_CONNECT_TIMEOUT_SECONDS,
        # pg_stat_activity 에서 우리 커넥션을 식별하기 위한 표식.
        "application_name": "skn30-backend",
    }
    _pool_kwargs = {
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_timeout": settings.DB_POOL_TIMEOUT_SECONDS,
        "pool_recycle": settings.DB_POOL_RECYCLE_SECONDS,
        # pooler 가 끊은 좀비 커넥션을 재사용하지 않도록 체크아웃 시 확인한다.
        "pool_pre_ping": True,
    }

# Postgres 면 psycopg3 로 정규화된 URL(app_database_url), 아니면 SQLite 폴백 URL 그대로.
# 정규화 덕분에 APP_DB_URL 에 postgresql:// 를 써도 psycopg2 를 찾다가 죽지 않는다.
engine = create_engine(
    settings.app_database_url or settings.APP_DB_URL,
    connect_args=_connect_args,
    future=True,
    **_pool_kwargs,
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    """요청당 DB 세션을 열고 닫는 FastAPI 의존성."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── 앱 데이터(chat history 등) ────────────────────────────────────────
# 실데이터가 있는 Supabase Postgres. 여기 붙는 role 은 RLS 를 우회하므로 소유권 검증은
# 라우트 코드가 담당한다. Postgres 가 아니면(SQLite 폴백) None → 요청 시 503.
# 테이블은 sql/schema.sql 이 소유하므로 이 엔진에는 create_all 을 호출하지 않는다.
#
# Postgres 에서는 위 engine 과 **같은 객체**다(풀 1벌). SQLite 에서만 None 으로 갈린다.
app_engine = engine if settings.app_database_url else None
AppSessionLocal = SessionLocal if app_engine is not None else None


def get_app_db() -> Generator[Session, None, None]:
    """앱 데이터용 DB 세션(필수). 저장소(APP_DB_URL) 미설정이면 503."""
    if AppSessionLocal is None:
        raise AppError("대화 기록 사용 불가", "대화 기록 저장소가 설정되지 않았습니다.", 503)
    db = AppSessionLocal()
    try:
        yield db
    finally:
        db.close()
