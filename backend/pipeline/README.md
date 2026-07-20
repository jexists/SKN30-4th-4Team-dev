# pipeline — 오프라인 배치 색인

`data/` 의 원본 문서(법령·판례·계약서 등)를 읽어 **청킹 → 임베딩 → Supabase(pgvector) 적재**하는 배치 작업입니다.
런타임 API 와 같은 로직(`app/services/ingestion`)을 공유합니다.

## 실행 (backend/ 에서)

```bash
uv run python -m pipeline.build_index
```

> 지금은 자리표시자입니다. RAG 구현 단계에서 채웁니다.
