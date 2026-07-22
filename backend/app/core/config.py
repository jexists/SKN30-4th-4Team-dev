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

    # Supabase (인증·파일저장용) — 지금은 자리표시
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # RAG 벡터 스토어(pgvector) 연결. 임베딩(legal_chunks)이 있는 Postgres.
    # 없으면 DATABASE_URL 이 Postgres 일 때 그걸 쓰고, 둘 다 Postgres 가 아니면 검색 비활성.
    DB_URL: str = ""

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def vector_db_dsn(self) -> str:
        """psycopg.connect 용 DSN.

        DB_URL 우선, 없으면 Postgres 인 DATABASE_URL, 둘 다 아니면 빈 문자열."""
        url = self.DB_URL or (
            self.DATABASE_URL if not self.DATABASE_URL.startswith("sqlite") else ""
        )
        if not url:
            return ""
        for prefix in ("postgresql+psycopg2://", "postgresql+psycopg://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql://" + url[len(prefix) :]
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
