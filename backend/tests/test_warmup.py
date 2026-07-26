import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import ModuleType

import pytest
from fastapi.testclient import TestClient

from app import main
from app.api.routes import chat
from app.core.config import settings
from app.services.ingestion import embedder


class FakeVectors:
    def __init__(self, values):
        self.values = values

    def tolist(self):
        return self.values


@pytest.fixture(autouse=True)
def _reset_embedder(monkeypatch):
    """테스트마다 싱글턴·상태를 비운다(monkeypatch 가 teardown 에서 원복)."""
    monkeypatch.setattr(embedder, "_model", None)
    monkeypatch.setattr(embedder, "_state", "idle")


def _install_fake_sentence_transformer(monkeypatch, fake_class):
    """실제 패키지 대신 가짜 sentence_transformers 모듈을 주입한다."""
    fake_module = ModuleType("sentence_transformers")
    fake_module.SentenceTransformer = fake_class
    monkeypatch.setitem(sys.modules, "sentence_transformers", fake_module)


def _track_warmup_completion(monkeypatch):
    """_warmup 전체가 끝났음을 알리는 Event. 데몬 스레드가 teardown 을 넘기지 않게 한다."""
    done = threading.Event()
    real_warmup = main._warmup

    def tracked():
        try:
            real_warmup()
        finally:
            done.set()

    monkeypatch.setattr(main, "_warmup", tracked)
    return done


def test_get_model_loads_once_under_concurrency(monkeypatch):
    start = threading.Barrier(9)  # 워커 8 + 본 스레드 1

    class FakeSentenceTransformer:
        calls = 0

        def __init__(self, _name):
            type(self).calls += 1
            time.sleep(0.05)  # 락이 없으면 나머지 7개가 None 검사를 통과할 시간

    _install_fake_sentence_transformer(monkeypatch, FakeSentenceTransformer)

    def load():
        start.wait()
        return embedder.get_model()

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(load) for _ in range(8)]
        start.wait()
        models = [f.result(timeout=5) for f in futures]

    assert FakeSentenceTransformer.calls == 1
    assert len({id(model) for model in models}) == 1


def test_warmup_loads_and_reports_ready(monkeypatch):
    class FakeSentenceTransformer:
        def __init__(self, _name):
            pass

        def get_embedding_dimension(self):
            return embedder.EMBED_DIM

        def encode(self, texts, **_kwargs):
            return FakeVectors([[0.0] * embedder.EMBED_DIM for _ in texts])

    _install_fake_sentence_transformer(monkeypatch, FakeSentenceTransformer)

    assert embedder.warmup() is True
    assert embedder.status() == "ready"
    assert embedder.is_ready() is True


def test_state_not_ready_before_first_inference(monkeypatch):
    class FakeSentenceTransformer:
        def __init__(self, _name):
            pass

    _install_fake_sentence_transformer(monkeypatch, FakeSentenceTransformer)

    embedder.get_model()

    assert embedder.status() != "ready"
    assert embedder.is_ready() is False


def test_warmup_dim_mismatch_fails(monkeypatch):
    class FakeSentenceTransformer:
        def __init__(self, _name):
            pass

        def get_embedding_dimension(self):
            return embedder.EMBED_DIM + 1

    _install_fake_sentence_transformer(monkeypatch, FakeSentenceTransformer)

    assert embedder.warmup() is False
    assert embedder.status() == "failed"


def test_warmup_swallows_failure(monkeypatch):
    def fail():
        raise RuntimeError("가짜 모델 로드 실패")

    monkeypatch.setattr(embedder, "get_model", fail)

    assert embedder.warmup() is False
    assert embedder.status() == "failed"


def test_lifespan_skips_warmup_when_disabled(monkeypatch):
    called = threading.Event()
    monkeypatch.setattr(settings, "WARMUP_ON_STARTUP", False)
    monkeypatch.setattr(main, "_warmup", called.set)

    with TestClient(main.app):
        pass

    assert called.is_set() is False


def test_lifespan_warms_up_in_background(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "WARMUP_ON_STARTUP", True)
    monkeypatch.setattr(settings, "RAG_DB_URL", "postgresql://example.test/db")
    monkeypatch.setattr(chat, "prewarm_engine", lambda: calls.append("engine") or True)
    monkeypatch.setattr(embedder, "warmup", lambda: calls.append("embedder") or True)
    done = _track_warmup_completion(monkeypatch)

    with TestClient(main.app):
        assert done.wait(5)

    assert calls == ["engine", "embedder"]


def test_lifespan_skips_embedder_without_vector_db(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "WARMUP_ON_STARTUP", True)
    monkeypatch.setattr(settings, "RAG_DB_URL", "")
    monkeypatch.setattr(settings, "APP_DB_URL", "sqlite:///./app.db")
    monkeypatch.setattr(chat, "prewarm_engine", lambda: calls.append("engine") or True)
    monkeypatch.setattr(embedder, "warmup", lambda: calls.append("embedder") or True)
    done = _track_warmup_completion(monkeypatch)

    with TestClient(main.app):
        assert done.wait(5)

    assert calls == ["engine"]
