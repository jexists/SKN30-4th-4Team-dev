"""app/services/retrieval/search.py — 커넥션 풀 재사용과 fail-soft 계약.

검색마다 psycopg.connect 를 새로 열면 SQLAlchemy 풀과 별개로 pooler 슬롯을 상한 없이 먹는다.
풀이 한 번만 생성되고 재사용되는지, 실패가 대화를 끊지 않는지를 여기서 잡는다.
"""

import threading
import time
from contextlib import contextmanager

import pytest

from app.core.config import settings
from app.services.retrieval import search

DSN_URL = "postgresql://user:pw@db.example.com:6543/postgres"


class FakePool:
    """psycopg_pool.ConnectionPool 대역. 생성 횟수와 인자를 기록한다."""

    instances: list["FakePool"] = []

    def __init__(self, dsn, **kwargs):
        time.sleep(0.01)  # 동시 최초 호출 경합을 실제로 발생시키기 위한 지연
        self.dsn = dsn
        self.kwargs = kwargs
        self.opened = False
        self.closed = False
        self.rows: list[tuple] = []
        self.raises: Exception | None = None
        self.executed: list[tuple] = []
        FakePool.instances.append(self)

    # ConnectionPool.check_connection 대응 (search 가 참조만 한다)
    @staticmethod
    def check_connection(conn):  # pragma: no cover - 호출되지 않음
        return None

    def open(self):
        self.opened = True

    def close(self):
        self.closed = True

    @contextmanager
    def connection(self):
        if self.raises is not None:
            raise self.raises
        yield self._conn()

    def _conn(self):
        pool = self

        class _Conn:
            @contextmanager
            def cursor(self):
                yield _Cursor()

        class _Cursor:
            def execute(self, sql, params):
                pool.executed.append((sql, params))

            def fetchall(self):
                return pool.rows

        return _Conn()


@pytest.fixture(autouse=True)
def _clean_pool():
    """모듈 전역 풀은 테스트 간에 새면 안 된다."""
    search.close_pool()
    FakePool.instances.clear()
    yield
    search.close_pool()
    FakePool.instances.clear()


@pytest.fixture()
def fake_pool(monkeypatch):
    """벡터 DB 가 설정된 상태 + ConnectionPool 대역 + 임베딩 스텁."""
    monkeypatch.setattr(settings, "RAG_DB_URL", DSN_URL)
    monkeypatch.setattr(search, "ConnectionPool", FakePool)
    monkeypatch.setattr(search, "embed_query", lambda q: [0.1] * 4)
    return FakePool


# ── 벡터 DB 미설정 ───────────────────────────────────────────────────
def test_no_dsn_skips_embedding(monkeypatch):
    """DSN 이 없으면 2GB 임베딩 모델을 돌리지 않고 바로 빠져야 한다."""
    monkeypatch.setattr(settings, "RAG_DB_URL", "")
    monkeypatch.setattr(settings, "APP_DB_URL", "sqlite:///./test-only.db")

    called = []
    monkeypatch.setattr(search, "embed_query", lambda q: called.append(q) or [0.1])

    assert search.search_similar("보증금 반환") == []
    assert called == []
    assert search._pool is None


# ── 풀 생성·재사용 ───────────────────────────────────────────────────
def test_pool_created_once_under_concurrency(fake_pool):
    """동기 라우트는 스레드풀에서 돈다 — 최초 동시 호출에도 풀은 하나만 만들어져야 한다."""
    barrier = threading.Barrier(8)

    def worker():
        barrier.wait()
        search._get_pool()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(fake_pool.instances) == 1
    assert fake_pool.instances[0].opened is True


def test_pool_is_reused_across_searches(fake_pool):
    search.search_similar("질문 1")
    search.search_similar("질문 2")
    assert len(fake_pool.instances) == 1
    assert len(fake_pool.instances[0].executed) == 2


def test_pool_options_bound_to_budget(fake_pool):
    """풀 상한·prepared statement 설정이 정책대로 걸려 있어야 한다."""
    search._get_pool()
    pool = fake_pool.instances[0]
    assert pool.kwargs["max_size"] == settings.RAG_POOL_MAX_SIZE
    assert pool.kwargs["min_size"] == 0
    assert pool.kwargs["max_idle"] == settings.RAG_POOL_MAX_IDLE_SECONDS
    assert pool.kwargs["max_lifetime"] == settings.RAG_POOL_MAX_LIFETIME_SECONDS
    assert pool.kwargs["open"] is False  # 생성자 open 은 deprecate
    assert pool.kwargs["kwargs"]["prepare_threshold"] is None
    assert pool.kwargs["kwargs"]["connect_timeout"] == settings.DB_CONNECT_TIMEOUT_SECONDS


# ── 결과 파싱 ────────────────────────────────────────────────────────
def test_hits_are_parsed_and_filtered(fake_pool):
    search._get_pool()
    fake_pool.instances[0].rows = [
        ("보증금 조항", {"law_name": "주택임대차보호법"}, 0.82),
        ("관련 없는 청크", {"court": "대법원"}, 0.05),  # min_score 미만 → 제외
        ("similarity 없음", {}, None),  # None → 제외
    ]

    hits = search.search_similar("보증금", min_score=0.15)

    assert len(hits) == 1
    assert hits[0]["content"] == "보증금 조항"
    assert hits[0]["law_name"] == "주택임대차보호법"
    assert hits[0]["similarity"] == pytest.approx(0.82)


def test_empty_result_is_not_an_error(fake_pool):
    """정상 조회인데 0건인 경우 — 빈 리스트이되 쿼리는 실제로 실행됐어야 한다."""
    search._get_pool()
    fake_pool.instances[0].rows = []

    assert search.search_similar("없는 주제") == []
    assert len(fake_pool.instances[0].executed) == 1


def test_issue_filter_is_applied(fake_pool):
    search._get_pool()
    search.search_similar("보증금", issues=["deposit"])
    sql, params = fake_pool.instances[0].executed[0]
    assert "WHERE issue = ANY(%(issues)s)" in sql
    assert params["issues"] == ["deposit"]


# ── fail-soft ───────────────────────────────────────────────────────
def test_connection_failure_returns_empty(fake_pool):
    """풀 대기·연결 실패는 대화를 끊지 않는다(빈 결과로 우회)."""
    search._get_pool()
    fake_pool.instances[0].raises = RuntimeError("pool timeout")

    assert search.search_similar("보증금") == []


def test_embedding_failure_returns_empty(fake_pool, monkeypatch):
    def boom(_):
        raise RuntimeError("model load failed")

    monkeypatch.setattr(search, "embed_query", boom)
    assert search.search_similar("보증금") == []


def test_pool_creation_failure_returns_empty(monkeypatch):
    """풀 생성(DSN 파싱·open) 실패도 대화를 끊지 않고, 전역에 반쯤 만든 풀을 남기지 않는다."""
    monkeypatch.setattr(settings, "RAG_DB_URL", DSN_URL)
    monkeypatch.setattr(search, "embed_query", lambda q: [0.1] * 4)

    class BoomPool(FakePool):
        def __init__(self, dsn, **kwargs):
            raise RuntimeError("cannot resolve host")

    monkeypatch.setattr(search, "ConnectionPool", BoomPool)

    assert search.search_similar("보증금") == []
    assert search._pool is None


# ── 종료 ────────────────────────────────────────────────────────────
def test_close_pool_resets_global(fake_pool):
    search._get_pool()
    pool = fake_pool.instances[0]

    search.close_pool()

    assert pool.closed is True
    assert search._pool is None


def test_close_pool_is_idempotent(fake_pool):
    """lifespan 이 테스트마다 돌고, 종료가 두 번 불릴 수도 있다."""
    search._get_pool()
    search.close_pool()
    search.close_pool()  # 두 번째 호출이 터지지 않아야 한다
    assert search._pool is None


def test_pool_recreated_after_close(fake_pool):
    """닫힌 풀을 다음 lifespan 이 재사용하면 안 된다."""
    search._get_pool()
    search.close_pool()
    search._get_pool()

    assert len(fake_pool.instances) == 2
    assert fake_pool.instances[0].closed is True
    assert fake_pool.instances[1].closed is False
