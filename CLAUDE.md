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

## 디자인 시스템 규칙 (프론트 필수)
프론트 UI 를 만들거나 수정할 때는 반드시 [`design.md`](design.md) 와 [`frontend/src/styles/_variables.scss`](frontend/src/styles/_variables.scss) 를 먼저 확인합니다.

- **페이지 배경은 반드시 `$page-bg` (#f2f4fb)**. 다른 색을 새 페이지에 쓰지 않는다.
- **새 색상을 임의로 추가하지 않는다.** 필요하면 `_variables.scss` 에 먼저 추가하고 `design.md` 를 함께 업데이트한다.
- **Typography 는 `_typography.scss` 믹스인만** 사용한다 (`t.body`, `t.h1` 등). `font-size: 14.5px` 같은 반쪽 값을 새로 만들지 않는다.
- **Spacing 은 4pt 스케일 (`$space-*`)** 만 사용한다. 임의의 `padding: 13px` 같은 값을 새로 만들지 않는다.
- **radius/shadow/z-index/transition/breakpoint** 도 토큰만 사용한다.
- **공통 컴포넌트 우선**: Button/Input/Card/Modal/Toast 등을 새로 만들기 전에 `frontend/src/components/*` 를 확인한다. rule of three 를 넘긴 반복이면 페이지 로컬로 만들지 말고 `components/` 로 추출한다.
- **CSS 중복 금지**: 같은 스타일 블록이 반복되면 SCSS 믹스인이나 공통 컴포넌트로 뽑는다.
- **디자인 시스템이 바뀌면 `design.md` 도 함께 업데이트한다** (토큰 추가, 컴포넌트 추출, anti-pattern 발견 시).
- 자세한 규칙·인벤토리·anti-patterns 는 `design.md` 참고.

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
