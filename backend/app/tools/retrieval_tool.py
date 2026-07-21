"""검색 툴 (자리표시).

services/retrieval 의 벡터 검색을 에이전트가 호출할 수 있는 툴로 감싼다.
전·월세 관련 법령·판례·상담 사례에서 근거 문서를 찾아온다.
"""

from app.services.retrieval import search


def retrieve(query: str, top_k: int = 5) -> list[dict]:
    # services/retrieval.search 재사용 (DRY).
    return search(query, top_k=top_k)
