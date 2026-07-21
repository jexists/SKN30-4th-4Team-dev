# 백엔드 작업 규칙 (FastAPI)

> 이 파일은 `backend/` 작업 시 자동 로드됩니다. 공통 규칙은 루트 `CLAUDE.md` 참고.

## 스택
- FastAPI · uv · Python 3.12
- DB: **Supabase Postgres + pgvector** (하이브리드 — Supabase=호스팅, **SQLAlchemy=ORM**). `supabase-py` 클라이언트는 쓰지 않음.
- 로컬은 `DATABASE_URL` 미설정 시 SQLite 폴백.

## 폴더 레이아웃
- `app/main.py` — 앱 생성, CORS·에러핸들러·로깅 등록, 라우터 `/api/v1` prefix
- `app/api/routes/` — 엔드포인트. `app/api/deps.py` — 공통 의존성(`get_current_user`)
- `app/core/` — `config`(설정)·`logging`·`exceptions`(에러핸들러)·`security`(JWT 검증)
- `app/db/` — `base`(DeclarativeBase)·`session`(`get_db`)
- `app/models/` — **ERD = ORM 모델** (DB 테이블). 실제 엔티티 이름으로 파일 추가 후 `__init__`에서 import
- `app/schemas/` — **Pydantic = API 입출력**. `common.py` = 표준 응답 봉투
- `app/services/` — 비즈니스 로직. `ingestion`(청킹·임베딩·색인)·`retrieval`(검색)
- `app/agent/` — LangGraph 에이전트. `state`(공유 상태)·`prompts`·`model`(LLM 팩토리)·`nodes`(노드)·`graph`(조립·`build_graph`). `services`·`tools` 를 호출하는 상위 계층
- `app/tools/` — 에이전트가 호출하는 툴. `base`(Tool 인터페이스)·`retrieval_tool`(검색 툴)
- `pipeline/` — 오프라인 배치 색인 러너

## 핵심 규칙
- **`models`(ERD·DB) ↔ `schemas`(Pydantic·API) 항상 분리.** 필드가 겹쳐도 역할이 다르다.
- **모든 엔드포인트는 표준 봉투로 응답**: `success_response(data)` / 에러는 예외를 던지면 `core/exceptions` 핸들러가 `error` 봉투로 자동 변환.
- **API 경로는 `/api/v1` prefix.**
- **비밀값(Supabase/API 키) 하드코딩 금지** — `.env`(pydantic-settings)로만.
- **청킹·임베딩 로직은 `services/ingestion`** 에 두고, 오프라인 배치(`pipeline/`)와 런타임이 공유.
- **인증**: Supabase Auth 가 로그인·토큰 발급. 백엔드는 `security.verify_token` 으로 **검증만**. 로그인/회원가입 엔드포인트는 만들지 않음.

## 명령
```bash
uv sync                                   # 의존성 설치
uv run uvicorn app.main:app --reload --port 8000
uv run pytest                             # 테스트 (TDD 권장: red→green→refactor)
uv run ruff check . && uv run ruff format .
uv run python -m pipeline.build_index     # 배치 색인 (자리표시)
```

## 지금은 자리표시 (나중에 채움 / 삭제)
- `models/` 비어 있음 → ERD 설계(`docs/ERD.md`) 후 채움 + Alembic 도입
- `services/ingestion`·`retrieval`, `agent`(LangGraph)·`tools`, `pipeline/build_index` → RAG·에이전트 구현 시 채움(LangGraph 등 의존성도 그때 추가)
- `/api/v1/hello` → 데모, 실제 개발 시 삭제. **`/api/v1/health` 는 유지**(표준 헬스체크)
