from functools import lru_cache

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

    # 사용자 계약서 OCR/마스킹은 별도 worker에서 실행한다.
    OCR_WORKER_URL: str = "http://ocr-worker:8100"
    OCR_WORKER_TIMEOUT_SECONDS: float = 10.0

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def _app_pg_url(self) -> str:
        """앱 데이터(chat history 등)가 있는 Postgres URL 원본.

        반드시 APP_DB_URL 기준(=Base.metadata.create_all 이 향하는 곳). RAG 벡터 스토어
        (RAG_DB_URL) 와 뒤섞으면 chat_room/chat_message 테이블이 만들어진 DB 와 조회하는 DB 가
        갈려 "관계 없음" 실패가 난다. APP_DB_URL 이 SQLite 면 빈 문자열 → 로컬 개발에서
        app_engine 은 비활성(get_app_db 가 503) — 스켈레톤(SessionLocal) 은 별개다."""
        return "" if self.APP_DB_URL.startswith("sqlite") else self.APP_DB_URL

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
