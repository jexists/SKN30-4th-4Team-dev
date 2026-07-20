# CLAUDE.md — 공통 작업 규칙

> [SKN30-3rd-4Team](https://github.com/SKNETWORKS-FAMILY-AICAMP/SKN30-3rd-4Team) 고도화 프로젝트 (전·월세 분쟁 팩트체커).
> **백엔드 작업 → [`backend/CLAUDE.md`](backend/CLAUDE.md), 프론트 작업 → [`frontend/CLAUDE.md`](frontend/CLAUDE.md)** 를 참고하세요.
> (중첩 CLAUDE.md 는 해당 폴더 작업 시 자동 로드됩니다.)

## 스택 요약
- 백엔드: FastAPI · uv · Python 3.12
- 프론트: React · Vite · TypeScript · npm
- DB: **Supabase Postgres + pgvector** (하이브리드 — Supabase 호스팅, SQLAlchemy ORM)
- 인증: Supabase Auth (백엔드는 JWT 검증만)
- **Streamlit 미사용.** 임베딩·LLM 모델은 추후 결정.

## 폴더 지도
```
backend/   FastAPI (app/api·core·db·models·schemas·services, pipeline, tests)
frontend/  React (src/pages·components·hooks·api·types·styles)
data/      수집 데이터 (raw/processed)
docs/      PRD·architecture·ERD·conventions·setup·스캐폴딩_계획·폴더 파일 구조
final/     산출물
```

## 공통 규칙
- **API 응답 봉투**: 모든 엔드포인트는 표준 봉투(`success`·`code`·`message`·`data`·`error`). 프론트 `api/client.ts` 가 벗겨서 사용.
- **API 버전**: 모든 경로 `/api/v1` prefix.
- **models(ERD·DB) ↔ schemas(Pydantic·API) 분리.**
- **비밀값 커밋 금지** — `.env` 로만 (Supabase/API 키).
- **테스트/TDD**: 백엔드 `pytest`, 프론트 `Vitest`. TDD(red→green→refactor) 권장.

## 협업
- 브랜치: feature → `develop` → `main`.
- 커밋/PR: 한국어 Conventional Commits (`feat/fix/refactor/chore/docs/test/style/perf`). `/commit`·`/pr` 슬래시 커맨드 참고.
- 코드리뷰: CodeRabbit(`.coderabbit.yaml`). PR/머지/푸시는 Discord 로 알림.

## 자주 쓰는 명령
```bash
# 백엔드 (backend/ 에서)
uv sync
uv run uvicorn app.main:app --reload --port 8000
uv run pytest

# 프론트 (frontend/ 에서)
npm install
npm run dev
npm run test

# 전체 (루트에서, 선택)
docker compose up --build
```

> 결정 사항·할 일은 [`docs/스캐폴딩_계획.md`](docs/스캐폴딩_계획.md), 규칙은 [`docs/conventions.md`](docs/conventions.md) 참고.
