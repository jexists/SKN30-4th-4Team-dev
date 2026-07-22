"""청크·쿼리 임베딩 — KURE-v1 (nlpai-lab/KURE-v1, 1024차원).

적재(test/ingest_kure.py)와 검색(services/retrieval)이 **같은 모델**을 써야 벡터가 호환된다.
코사인 검색을 위해 정규화(normalize)한 벡터를 돌려준다.

sentence-transformers·torch 필요. 모델(~2GB)은 최초 호출 시 로드된다(지연 로드).
"""

from __future__ import annotations

import logging

log = logging.getLogger(__name__)

MODEL_NAME = "nlpai-lab/KURE-v1"
EMBED_DIM = 1024

_model = None


def get_model():
    """KURE-v1 SentenceTransformer 싱글턴 (최초 1회 로드)."""
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer  # 지연 import (무거움)

        log.info("임베딩 모델 로드: %s", MODEL_NAME)
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed_texts(texts: list[str], batch_size: int = 32) -> list[list[float]]:
    """여러 텍스트 → 정규화 임베딩 리스트."""
    model = get_model()
    vecs = model.encode(
        texts,
        batch_size=batch_size,
        normalize_embeddings=True,
        convert_to_numpy=True,
    )
    return vecs.tolist()


def embed_query(text: str) -> list[float]:
    """단일 쿼리 → 정규화 임베딩 벡터."""
    return embed_texts([text])[0]
