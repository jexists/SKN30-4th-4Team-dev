"""문서 → 청크 분할 (자리표시).

RAG 구현 단계에서 문서 텍스트를 검색 단위 청크로 나누는 로직을 채웁니다.
청크 크기·오버랩 등 파라미터는 docs/conventions.md 에서 합의 후 결정.
"""


def chunk_text(text: str) -> list[str]:
    raise NotImplementedError("RAG 구현 단계에서 작성")
