"""임베딩 → Supabase(pgvector) 적재 (자리표시).

RAG 구현 단계에서 벡터를 Supabase Postgres(pgvector) 에 upsert 합니다.
"""


def upsert(vectors: list[list[float]], payloads: list[dict]) -> None:
    raise NotImplementedError("RAG 구현 단계에서 작성")
