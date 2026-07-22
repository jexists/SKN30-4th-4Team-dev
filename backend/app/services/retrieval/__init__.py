"""런타임 검색 — legal_chunks(pgvector) 유사도 검색.

질의를 KURE-v1 로 임베딩해 코사인 유사 청크를 돌려준다(services.retrieval.search).
graph_rag 의 retrieve 노드가 이 search_similar 를 호출한다.
"""

from app.services.retrieval.search import search_similar

__all__ = ["search_similar"]
