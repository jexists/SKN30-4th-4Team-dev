"""런타임 검색 (자리표시).

질의를 임베딩해 Supabase(pgvector)에서 유사도 검색하는 로직을 RAG 구현 단계에서 채웁니다.
"""


def search(query: str, top_k: int = 5) -> list[dict]:
    raise NotImplementedError("RAG 구현 단계에서 작성")
