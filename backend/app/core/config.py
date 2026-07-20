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

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
