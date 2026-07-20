"""청크 → 임베딩 벡터 (자리표시).

RAG 구현 단계에서 임베딩 모델(추후 선택)로 청크를 벡터화합니다.
"""


def embed(chunks: list[str]) -> list[list[float]]:
    raise NotImplementedError("RAG 구현 단계에서 작성")
