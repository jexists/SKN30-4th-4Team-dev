from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "SKN30-4th-4Team API"

    # 앱 데이터 DB(chat_room·chat_message). RAG 용은 아래 RAG_DB_URL — 자세한 건 README.
    # SQLite 폴백이면 서버는 뜨지만 대화 기록 API 가 503. 정규화 없이 create_engine 에
    # 넘어가므로 postgresql+psycopg:// 접두사를 직접 써야 한다(psycopg2 미설치).
    APP_DB_URL: str = "sqlite:///./app.db"

    # 쉼표로 구분된 CORS 허용 origin 목록
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:4173"

    # Supabase (인증·파일저장용) — 지금은 자리표시.
    # SUPABASE_URL 은 비대칭키(JWKS) 토큰 검증 시 공개키 출처로도 쓰인다
    #   ({SUPABASE_URL}/auth/v1/.well-known/jwks.json).
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # Supabase Auth JWT 검증용(HS256 대칭키). 대시보드 → Settings → API → JWT Settings → JWT Secret.
    # 프로젝트가 비대칭키(ES256/RS256)를 쓰면 이 값 없이 SUPABASE_URL 의 JWKS 로 검증한다.
    # 둘 다 없으면 verify_token 이 항상 None → 보호 엔드포인트는 401(fail-closed).
    SUPABASE_JWT_SECRET: str = ""
    # Supabase 액세스 토큰의 기대 audience. 기본값 authenticated 를 바꿀 일은 거의 없다.
    SUPABASE_JWT_AUD: str = "authenticated"
    # exp/nbf/iat 검사 시 허용할 클라이언트·서버 시계 오차(초).
    # 0 이면 재부팅 직후처럼 시계가 조금 어긋난 사용자가 멀쩡한 토큰으로도 401 을 받는다.
    JWT_LEEWAY_SECONDS: int = 60

    # RAG 벡터 스토어(pgvector·legal_chunks). 비우면 APP_DB_URL 재사용.
    # 둘 다 Postgres 가 아니면 검색이 조용히 꺼진다(빈 결과 → 근거 없는 답변).
    RAG_DB_URL: str = ""

    # ── DB 커넥션 풀 ────────────────────────────────────────────────
    # Supabase pooler 는 클라이언트 슬롯이 한정돼 있고, 팀원 여러 명이 각자 로컬 서버를 띄워
    # 같은 DB 에 붙는다. 연결 예산은 "동시 접속 사용자 수" 가 아니라 "백엔드 프로세스 수" 기준이다.
    #   프로세스당 최대 = (DB_POOL_SIZE + DB_MAX_OVERFLOW) + RAG_POOL_MAX_SIZE
    # 기본값 3+2+2=7. 전체(replica×worker + 로컬 프로세스) × 7 이 Max Pooler Clients 의
    # 절반을 넘지 않게 유지한다.
    DB_POOL_SIZE: int = Field(default=3, ge=1)
    DB_MAX_OVERFLOW: int = Field(default=2, ge=0)
    DB_POOL_TIMEOUT_SECONDS: int = Field(default=10, gt=0)
    # pooler 가 조용히 끊은 커넥션을 오래 들고 있지 않도록 주기적으로 폐기한다.
    DB_POOL_RECYCLE_SECONDS: int = Field(default=1800, gt=0)
    DB_CONNECT_TIMEOUT_SECONDS: int = Field(default=10, gt=0)

    # RAG 벡터 검색(psycopg 직접)이 쓰는 별도 풀. SQLAlchemy 풀과 합산해서 예산을 잡는다.
    RAG_POOL_MAX_SIZE: int = Field(default=2, ge=1)
    RAG_POOL_MAX_IDLE_SECONDS: int = Field(default=300, gt=0)
    RAG_POOL_MAX_LIFETIME_SECONDS: int = Field(default=1800, gt=0)

    # 기동 시 임베딩 모델(KURE-v1 ~2GB)과 챗봇 엔진을 백그라운드 데몬 스레드로 미리 로드한다.
    # 끄면 첫 /api/v1/chat 요청이 그 로드를 대신 물어 10~20초 걸린다. 워밍업은 기동을 막지
    # 않고, 실패해도 서버는 그대로 뜬다(검색만 빈 결과로 우회).
    # 테스트·CI 는 반드시 꺼야 한다 — 캐시가 없으면 HuggingFace 에서 2GB 를 내려받는다.
    WARMUP_ON_STARTUP: bool = True

    # 사용자 계약서 OCR/마스킹은 별도 worker에서 실행한다.
    OCR_WORKER_URL: str = "http://ocr-worker:8100"
    OCR_WORKER_TIMEOUT_SECONDS: float = 10.0
    OCR_WORKER_PROCESS_TIMEOUT_SECONDS: float = 1200.0
    # 서류 종류(계약서·등기부등본·건축물대장)가 아니라 한 요청의 전체 파일 수 상한이다.
    # 한 서류가 여러 장으로 스캔돼 오는 경우가 많아 종류 수보다 넉넉히 잡는다.
    CONTRACT_MAX_FILES: int = 10
    CONTRACT_MAX_FILE_MB: int = 20
    CONTRACT_ANALYSIS_MODEL: str = "gpt-4.1-mini"
    CONTRACT_ANALYSIS_MAX_CHARS: int = 50_000
    CONTRACT_ANALYSIS_MAX_TOTAL_CHARS: int = 150_000
    # 로컬 시연에서 API 키가 없으면 기본 계약 조건과 위험 키워드를 규칙으로 분석한다.
    CONTRACT_ANALYSIS_LOCAL_FALLBACK: bool = True
    OPENAI_API_KEY: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        """SQLite 폴백 여부. 풀 옵션·기동 DDL 분기의 단일 기준점."""
        return self.APP_DB_URL.startswith("sqlite")

    @property
    def _app_pg_url(self) -> str:
        """앱 데이터(chat history 등)가 있는 Postgres URL 원본.

        반드시 APP_DB_URL 기준(=Base.metadata.create_all 이 향하는 곳). RAG 벡터 스토어
        (RAG_DB_URL) 와 뒤섞으면 chat_room/chat_message 테이블이 만들어진 DB 와 조회하는 DB 가
        갈려 "관계 없음" 실패가 난다. APP_DB_URL 이 SQLite 면 빈 문자열 → 로컬 개발에서
        app_engine 은 비활성(get_app_db 가 503) — 스켈레톤(SessionLocal) 은 별개다."""
        return "" if self.is_sqlite else self.APP_DB_URL

    @property
    def vector_db_dsn(self) -> str:
        """psycopg.connect 용 DSN (RAG 벡터 스토어).

        RAG_DB_URL 우선, 없으면 앱 DB 재사용. 둘 다 없으면 빈 문자열(검색 비활성)."""
        url = self.RAG_DB_URL or self._app_pg_url
        if not url:
            return ""
        for prefix in ("postgresql+psycopg2://", "postgresql+psycopg://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql://" + url[len(prefix) :]
        return url

    @property
    def app_database_url(self) -> str:
        """앱 데이터용 SQLAlchemy URL(psycopg3 드라이버로 정규화).

        chat_room/chat_message 등 실데이터가 있는 Supabase Postgres. Postgres 가 아니면 빈 문자열
        → get_app_db 가 503 을 던진다. RAG(RAG_DB_URL) 와 무관하게 APP_DB_URL 만 본다."""
        url = self._app_pg_url
        if not url:
            return ""
        for prefix in (
            "postgresql+psycopg://",
            "postgresql+psycopg2://",
            "postgresql://",
            "postgres://",
        ):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
