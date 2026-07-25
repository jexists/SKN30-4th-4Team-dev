from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.exceptions import AppError

# SQLite 폴백일 때만 필요한 연결 옵션 (Postgres/Supabase 에서는 불필요)
_connect_args = {"check_same_thread": False} if settings.APP_DB_URL.startswith("sqlite") else {}

engine = create_engine(settings.APP_DB_URL, connect_args=_connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    """요청당 DB 세션을 열고 닫는 FastAPI 의존성(뼈대용 SQLite/기본 엔진)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ── 앱 데이터(chat history 등) 전용 엔진 ──────────────────────────────
# 실데이터가 있는 Supabase Postgres(app_database_url). 여기 붙는 role 은 RLS 를 우회하므로
# 소유권 검증은 라우트 코드가 담당한다. 미설정(Postgres 아님)이면 None → 요청 시 503.
# 테이블은 sql/schema.sql 로 이미 존재하므로 이 엔진에는 create_all 을 호출하지 않는다.
app_engine = (
    create_engine(settings.app_database_url, pool_pre_ping=True, future=True)
    if settings.app_database_url
    else None
)
AppSessionLocal = (
    sessionmaker(bind=app_engine, autocommit=False, autoflush=False) if app_engine else None
)


def get_app_db() -> Generator[Session, None, None]:
    """앱 데이터용 DB 세션(필수). 저장소(APP_DB_URL) 미설정이면 503."""
    if AppSessionLocal is None:
        raise AppError("대화 기록 사용 불가", "대화 기록 저장소가 설정되지 않았습니다.", 503)
    db = AppSessionLocal()
    try:
        yield db
    finally:
        db.close()
