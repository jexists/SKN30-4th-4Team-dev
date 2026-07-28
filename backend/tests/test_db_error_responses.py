"""DB 오류 → HTTP 상태 매핑.

커넥션 고갈은 버그가 아니라 일시적 장애다. 500 으로 내려가면 프론트가 재시도할 근거가 없고
CodeRabbit·모니터링에서도 애플리케이션 버그와 구분되지 않는다. 반대로 문법 오류나 없는
테이블까지 503 으로 숨기면 진짜 버그를 못 본다. 그 경계를 여기서 고정한다.
"""

from typing import Annotated

import psycopg
import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient
from psycopg_pool import PoolTimeout
from sqlalchemy.exc import OperationalError, ProgrammingError
from sqlalchemy.exc import TimeoutError as SATimeoutError

from app.core.exceptions import register_exception_handlers

# 실제로 겪은 메시지 — Supavisor session mode 클라이언트 슬롯 고갈.
EMAXCONNSESSION = (
    "connection failed: FATAL:  (EMAXCONNSESSION) max clients reached in session mode "
    "- max clients are limited to pool_size: 15"
)


@pytest.fixture()
def client():
    app = FastAPI()
    register_exception_handlers(app)

    # 라우트 본문이 아니라 **의존성**에서 던진다 — 원래 장애도 require_member 안에서 터졌고,
    # 그 경로도 핸들러를 타는지가 이 테스트의 핵심이다.
    def failing_dep(request: Request) -> None:
        raise request.app.state.exc

    @app.get("/boom")
    def boom(_: Annotated[None, Depends(failing_dep)]) -> dict:
        return {}  # pragma: no cover - 의존성에서 항상 예외가 난다

    return TestClient(app, raise_server_exceptions=False)


def _get(client: TestClient, exc: Exception):
    client.app.state.exc = exc
    return client.get("/boom")


def test_connection_refused_is_503(client):
    """EMAXCONNSESSION 은 연결 자체를 못 맺은 경우 — connection_invalidated 가 False 다."""
    exc = OperationalError("SELECT 1", None, psycopg.OperationalError(EMAXCONNSESSION))
    assert exc.connection_invalidated is False  # 이 조건만 보면 못 잡는다

    res = _get(client, exc)

    assert res.status_code == 503
    body = res.json()
    assert body["success"] is False
    assert body["code"] == 503  # 프론트는 이 값으로 분기한다
    assert body["error"]["title"]
    # 내부 예외 문자열이 사용자에게 새면 안 된다(로그에만 남긴다).
    assert "EMAXCONNSESSION" not in res.text
    assert "psycopg" not in res.text


def test_invalidated_connection_is_503(client):
    exc = OperationalError(
        "SELECT 1",
        None,
        psycopg.OperationalError("server closed the connection unexpectedly"),
        connection_invalidated=True,
    )
    assert _get(client, exc).status_code == 503


def test_admin_shutdown_is_503(client):
    """서버 종료·복구 중 연결 불가는 재시도 가능한 503이다."""
    exc = OperationalError("SELECT 1", None, psycopg.errors.AdminShutdown("server shutting down"))
    assert _get(client, exc).status_code == 503


def test_queuepool_timeout_is_503(client):
    """SQLAlchemy 의 TimeoutError 는 OperationalError 서브클래스가 아니다 — 별도 핸들러."""
    assert not issubclass(SATimeoutError, OperationalError)
    exc = SATimeoutError("QueuePool limit of size 3 overflow 2 reached")
    assert _get(client, exc).status_code == 503


def test_psycopg_pool_timeout_is_503(client):
    exc = PoolTimeout("couldn't get a connection after 10.00 sec")
    assert _get(client, exc).status_code == 503


def test_programming_error_stays_500(client):
    """없는 테이블·문법 오류까지 503 으로 숨기면 스키마 버그를 못 본다."""
    exc = ProgrammingError(
        "SELECT * FROM nope", None, psycopg.ProgrammingError('relation "nope" does not exist')
    )
    res = _get(client, exc)

    assert res.status_code == 500
    assert res.json()["code"] == 500


def test_invalid_password_stays_500(client):
    """영구 설정 오류를 접속 폭주로 오인해 재시도시키면 안 된다."""
    exc = OperationalError(
        "connect",
        None,
        psycopg.errors.InvalidPassword("password authentication failed"),
    )
    res = _get(client, exc)

    assert res.status_code == 500
    assert res.json()["code"] == 500
