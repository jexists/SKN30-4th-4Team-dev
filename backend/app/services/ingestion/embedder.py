"""청크·쿼리 임베딩 — KURE-v1 (nlpai-lab/KURE-v1, 1024차원).

적재(test/ingest_kure.py)와 검색(services/retrieval)이 **같은 모델**을 써야 벡터가 호환된다.
코사인 검색을 위해 정규화(normalize)한 벡터를 돌려준다.

sentence-transformers·torch 필요. 모델(~2GB)은 기동 시 백그라운드로 미리 로드
(main.py lifespan → warmup)하고, 꺼져 있거나 실패하면 최초 호출 시 지연 로드한다.
"""

from __future__ import annotations

import logging
import threading
import time

log = logging.getLogger(__name__)

MODEL_NAME = "nlpai-lab/KURE-v1"
EMBED_DIM = 1024

_model = None
# 동기 라우트는 anyio 스레드풀(기본 limiter 40)에서 돌기 때문에 여러 요청이 동시에 get_model
# 로 들어올 수 있다. 락이 없으면 ~2GB 모델을 동시에 여러 번 로드한다 → double-checked locking.
_lock = threading.Lock()
# 워밍업 상태: idle | loading | ready | failed. torch 를 import 하지 않고 상태만 알려준다.
# ready 는 "모델이 올라왔다"가 아니라 "추론이 한 번 성공했다"는 뜻이다 — 모델 생성만으로는
# 토크나이저·커널 초기화가 남아 있어서, 그 상태로 ready 를 보고하면 헬스체크가 거짓이 된다.
# 여러 추론이 동시에 끝나면 마지막 쓰기가 이긴다(단순 텔레메트리라 락을 걸지 않는다).
_state = "idle"


def get_model():
    """KURE-v1 SentenceTransformer 싱글턴 (최초 1회 로드).

    이미 로드됐으면 락 없이 바로 돌려준다(빠른 경로). 로드 실패 시 _model 은 None 으로 남겨
    다음 호출이 재시도하게 한다 — 기동 시 일시적 네트워크 실패로 검색이 영구 비활성되지 않게.
    """
    global _model, _state
    if _model is not None:
        return _model
    with _lock:
        if _model is None:  # 락 안에서 재확인 — 먼저 들어온 스레드가 이미 로드했을 수 있다
            from sentence_transformers import SentenceTransformer  # 지연 import (무거움)

            log.info("임베딩 모델 로드: %s", MODEL_NAME)
            _state = "loading"
            started = time.perf_counter()
            try:
                model = SentenceTransformer(MODEL_NAME)
            except Exception:
                _state = "failed"
                raise
            _model = model  # 아직 ready 아님 — 첫 encode 성공 시 승격
            log.info("임베딩 모델 로드 완료 (%.1f초)", time.perf_counter() - started)
    return _model


def embed_texts(texts: list[str], batch_size: int = 32) -> list[list[float]]:
    """여러 텍스트 → 정규화 임베딩 리스트."""
    global _state
    model = get_model()
    try:
        vecs = model.encode(
            texts,
            batch_size=batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            # 서버 로그에 진행률 바가 섞이지 않게 끈다 — 검색 쿼리는 1건 배치라 무의미하다.
            # (배치 색인은 test/ingest_kure.py 가 자체 embed_texts 로 진행률을 보여준다.)
            show_progress_bar=False,
        )
    except Exception:
        _state = "failed"
        raise
    if _state != "ready":
        _state = "ready"
    return vecs.tolist()


def embed_query(text: str) -> list[float]:
    """단일 쿼리 → 정규화 임베딩 벡터."""
    return embed_texts([text])[0]


def warmup() -> bool:
    """모델을 미리 로드하고 더미 추론까지 한 번 돌린다 (기동 시 백그라운드 호출용).

    SentenceTransformer 생성만으로는 부족하다 — 첫 encode() 에도 토크나이저·커널 초기화
    비용이 남아 있어서, 더미 문장을 한 번 통과시켜 첫 사용자 질문이 그 비용을 물지 않게 한다.
    실패는 삼킨다: 워밍업이 안 돼도 검색은 요청 시점에 다시 시도하고, 그때도 실패하면
    search_similar 가 빈 결과로 우회한다.
    """
    global _state
    started = time.perf_counter()
    try:
        model = get_model()
        # sentence-transformers 5.6 에서 get_sentence_embedding_dimension 은 이 이름으로
        # 바뀌었다(구 이름은 FutureWarning). pyproject 가 >=5.6.0 을 요구하므로 안전하다.
        dim = model.get_embedding_dimension()
        if dim != EMBED_DIM:
            # 적재 벡터와 차원이 다르면 pgvector 연산이 에러를 내고 search.py 가 빈 결과로
            # 삼킨다 → 검색이 조용히 죽는다. ready 로 승격시키지 않고 failed 로 남긴다.
            raise RuntimeError(f"임베딩 차원 불일치: 모델 {dim} != 기대 {EMBED_DIM} ({MODEL_NAME})")
        embed_texts(["워밍업"])
    except Exception:
        _state = "failed"
        log.exception("임베딩 모델 워밍업 실패 — 검색은 요청 시 다시 시도한다")
        return False
    log.info("임베딩 모델 워밍업 완료: %s (%.1f초)", MODEL_NAME, time.perf_counter() - started)
    return True


def is_ready() -> bool:
    """추론이 한 번 성공해 바로 쓸 수 있는 상태인지 (torch 를 import 하지 않는다)."""
    return _state == "ready"


def status() -> str:
    """워밍업 상태 문자열 — idle | loading | ready | failed (헬스체크·로그용)."""
    return _state
