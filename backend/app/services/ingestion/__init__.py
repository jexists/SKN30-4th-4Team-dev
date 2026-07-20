"""청킹·임베딩·색인 로직 (자리표시).

오프라인 배치(pipeline/)와 런타임 처리(API)가 이 코드를 공유합니다(DRY).
실제 로직은 RAG 구현 단계에서 chunker/embedder/indexer 에 채웁니다.
"""
