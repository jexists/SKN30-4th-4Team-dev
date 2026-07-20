# 아키텍처

> 시스템 구성·데이터 흐름·주요 기술 결정을 기록합니다. (근거와 함께)

## 시스템 구성
```
[React (Vite)]  ──/api/v1──▶  [FastAPI]  ──ORM──▶  [Supabase Postgres + pgvector]
     프론트엔드                  백엔드                 관계형 + 벡터 저장
                                   │
                                   └── 인증: Supabase Auth (JWT 검증만)
```
_상세 작성 예정_

## 데이터 흐름
- **오프라인 색인(배치)**: `data/` 원본 → 청킹 → 임베딩 → Supabase(pgvector) 적재 (`backend/pipeline/`)
- **런타임**: 사용자 업로드/질의 → 임베딩·검색(`services/`) → LLM → 응답
_상세 작성 예정_

## 기술 결정 (요약)
자세한 결정 사항은 [스캐폴딩_계획.md](./스캐폴딩_계획.md), 규칙은 [conventions.md](./conventions.md) 참고.

- 백엔드: FastAPI (uv, Python 3.12), SQLAlchemy ORM
- 프론트: React + Vite + TypeScript
- DB: Supabase Postgres + pgvector (하이브리드 — Supabase 호스팅, SQLAlchemy ORM)
- 인증: Supabase Auth
- 임베딩·LLM 모델: _추후 결정_
