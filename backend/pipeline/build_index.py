"""오프라인 배치 색인 러너 (자리표시).

data/ 의 원본 문서를 읽어 청킹 → 임베딩 → Supabase(pgvector) 적재한다.
app.services.ingestion 의 로직을 재사용하는 얇은 CLI 진입점이다.

실행 (backend/ 에서):
    uv run python -m pipeline.build_index
"""


def main() -> None:
    # TODO(rag): app.services.ingestion 의 chunker/embedder/indexer 를 호출해
    #            data/ → Supabase 적재 파이프라인을 구성한다.
    raise NotImplementedError("RAG 구현 단계에서 작성")


if __name__ == "__main__":
    main()
