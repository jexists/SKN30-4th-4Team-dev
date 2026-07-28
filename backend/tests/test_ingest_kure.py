"""KURE 색인 CLI의 DB 연결 설정 회귀 방지."""

from test import ingest_kure


def test_resolve_database_url_reads_backend_env(monkeypatch, tmp_path):
    """uv run이 자동 로드하지 않는 .env에서 색인 전용 URL을 직접 읽어야 한다."""
    monkeypatch.delenv("INGEST_DATABASE_URL", raising=False)
    env_file = tmp_path / ".env"
    env_file.write_text(
        "INGEST_DATABASE_URL=postgresql+psycopg://user:pw@db.example.com:5432/postgres\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(ingest_kure, "_BACKEND_ENV_PATH", env_file)

    assert ingest_kure.resolve_database_url(None) == (
        "postgresql://user:pw@db.example.com:5432/postgres"
    )


def test_resolve_database_url_precedence(monkeypatch, tmp_path):
    """CLI > 프로세스 환경변수 > backend/.env 우선순위를 유지한다."""
    env_file = tmp_path / ".env"
    env_file.write_text(
        "INGEST_DATABASE_URL=postgresql://file:pw@file.example.com:5432/postgres\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(ingest_kure, "_BACKEND_ENV_PATH", env_file)
    monkeypatch.setenv(
        "INGEST_DATABASE_URL",
        "postgresql://env:pw@env.example.com:5432/postgres",
    )

    assert ingest_kure.resolve_database_url(
        "postgresql+psycopg://cli:pw@cli.example.com:5432/postgres"
    ) == "postgresql://cli:pw@cli.example.com:5432/postgres"
    assert ingest_kure.resolve_database_url(None) == (
        "postgresql://env:pw@env.example.com:5432/postgres"
    )
