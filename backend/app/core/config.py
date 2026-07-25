from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_NAME: str = "SKN30-4th-4Team API"

    # DATABASE_URL 미설정 시 로컬 SQLite 폴백.
    # Supabase 연결 시 .env 에 Postgres 연결 문자열을 넣으면 그걸로 전환됩니다.
    DATABASE_URL: str = "sqlite:///./app.db"

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

    # RAG 벡터 스토어(pgvector) 연결. 임베딩(legal_chunks)이 있는 Postgres.
    # 없으면 DATABASE_URL 이 Postgres 일 때 그걸 쓰고, 둘 다 Postgres 가 아니면 검색 비활성.
    DB_URL: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def _app_pg_url(self) -> str:
        """앱 데이터(chat history 등)가 있는 Postgres URL 원본.

        DB_URL 우선, 없으면 Postgres 인 DATABASE_URL, 둘 다 아니면 빈 문자열."""
        return self.DB_URL or (
            self.DATABASE_URL if not self.DATABASE_URL.startswith("sqlite") else ""
        )

    @property
    def vector_db_dsn(self) -> str:
        """psycopg.connect 용 DSN (RAG 벡터 스토어)."""
        url = self._app_pg_url
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
        → get_app_db 가 503(HISTORY_UNAVAILABLE). RAG 와 같은 소스(_app_pg_url)를 쓴다."""
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
