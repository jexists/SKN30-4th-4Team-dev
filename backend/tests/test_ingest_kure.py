"""KURE 색인 CLI의 DB 연결 설정 회귀 방지."""

import pytest

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

    assert (
        ingest_kure.resolve_database_url(
            "postgresql+psycopg://cli:pw@cli.example.com:5432/postgres"
        )
        == "postgresql://cli:pw@cli.example.com:5432/postgres"
    )
    assert ingest_kure.resolve_database_url(None) == (
        "postgresql://env:pw@env.example.com:5432/postgres"
    )


def test_missing_url_exits(monkeypatch, tmp_path):
    """런타임 URL(RAG_DB_URL/APP_DB_URL)로 fallback 하지 않고 종료해야 한다.

    transaction pooler(:6543) 로 DDL·대량 색인을 돌리는 사고를 막는 계약이다.
    """
    monkeypatch.delenv("INGEST_DATABASE_URL", raising=False)
    monkeypatch.setenv("RAG_DB_URL", "postgresql://rag:pw@rag.example.com:6543/postgres")
    monkeypatch.setenv("APP_DB_URL", "postgresql://app:pw@app.example.com:6543/postgres")
    monkeypatch.setattr(ingest_kure, "_BACKEND_ENV_PATH", tmp_path / "없는.env")

    with pytest.raises(SystemExit) as exc:
        ingest_kure.resolve_database_url(None)
    assert "INGEST_DATABASE_URL" in str(exc.value)


def test_sqlite_url_exits(monkeypatch, tmp_path):
    """pgvector 는 Postgres 가 필요하다 — SQLite 면 조용히 진행하지 않고 종료한다."""
    monkeypatch.delenv("INGEST_DATABASE_URL", raising=False)
    monkeypatch.setattr(ingest_kure, "_BACKEND_ENV_PATH", tmp_path / "없는.env")

    with pytest.raises(SystemExit) as exc:
        ingest_kure.resolve_database_url("sqlite:///./app.db")
    assert "Postgres" in str(exc.value)
