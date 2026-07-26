# 백엔드 작업 규칙 (FastAPI)

> 이 파일은 `backend/` 작업 시 자동 로드됩니다. 공통 규칙은 루트 `CLAUDE.md` 참고.

## 스택
- FastAPI · uv · Python 3.12
- DB: **Supabase Postgres + pgvector** (하이브리드 — Supabase=호스팅, **SQLAlchemy=ORM**). `supabase-py` 클라이언트는 쓰지 않음.
- DB 연결은 둘로 나뉜다: **`APP_DB_URL`**(앱 데이터 — `chat_room`·`chat_message`, SQLAlchemy ORM)과 **`RAG_DB_URL`**(pgvector 벡터 스토어 — `legal_chunks`, psycopg 직접). `RAG_DB_URL` 을 비우면 `APP_DB_URL` 을 재사용한다.
- 로컬은 `APP_DB_URL` 미설정 시 SQLite 폴백 — 서버는 뜨지만 대화 기록 API 는 503("대화 기록 사용 불가").

## 폴더 레이아웃
- `app/main.py` — 앱 생성, 기동 워밍업(lifespan → 데몬 스레드), CORS·에러핸들러·로깅 등록, 라우터 `/api/v1` prefix
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
- **모든 엔드포인트는 표준 봉투로 응답**: `success_response(data)` / 에러는 예외를 던지면 `core/exceptions` 핸들러가 `error` 봉투로 자동 변환. 필드 역할은 아래 「API 응답·에러 처리 정책」 참고.
- **API 경로는 `/api/v1` prefix.**
- **비밀값(Supabase/API 키) 하드코딩 금지** — `.env`(pydantic-settings)로만.
- **청킹·임베딩 로직은 `services/ingestion`** 에 두고, 오프라인 배치(`pipeline/`)와 런타임이 공유.
- **기동 워밍업은 실패해도 기동을 막지 않는다**(fail-soft — 검색은 빈 결과로 우회).
- **인증**: Supabase Auth 가 로그인·토큰 발급. 백엔드는 `security.verify_token` 으로 **검증만**. 로그인/회원가입 엔드포인트는 만들지 않음.

## API 응답·에러 처리 정책 (프로젝트 공통)

봉투(`schemas/common.py`)의 세 필드는 **프론트에서 서로 다른 UI 로 간다.** 아무 데나 문구를 넣으면 토스트와 모달에 같은 말이 두 번 뜬다.

| 필드 | 프론트 UI | 비었을 때 |
|---|---|---|
| `message` | **토스트 전용** | 토스트를 띄우지 않음 |
| `error.title` | **오류 모달 제목** | — |
| `error.message` | 오류 모달 본문 | 제목만 표시 |

- **`message` 는 알릴 게 있을 때만 채운다.** 저장·수정·삭제 완료처럼 사용자가 결과를 알아야 하는 경우다. 조회 API 는 비워 둔다(기본값 `""`). `"OK"` 같은 값을 넣으면 성공할 때마다 의미 없는 토스트가 뜬다.
- **성공 토스트 문구는 서버가 소유한다.** 프론트가 화면마다 `showToast(...)` 를 심지 않도록, `success_response(data, message="대화를 삭제했습니다.")` 처럼 서버가 내려준다.
- **`error.title`·`error.message` 는 그대로 사용자에게 보인다.** `INTERNAL_ERROR` 같은 코드형 문자열이나 내부 예외 문자열(`f"...: {e}"`)을 넣지 않는다. 읽을 수 있는 한국어를 쓰고, 원인은 `logger.exception(...)` 으로 남긴다.
- **분기용 식별자는 `code`(HTTP 상태)다.** 프론트도 `error.code` 로만 판단한다(예: 401 → 세션 갱신·로그아웃). title 로 분기하지 않는다.
- **에러는 기본적으로 토스트를 내지 않는다.** 굳이 함께 띄우려면 `AppError(..., toast="...")`.
- **실패를 "데이터 없음"으로 표현하지 않는다.** 빈 목록(`items: []`)은 `success: true` 일 때만 의미가 있다. 프론트는 실패를 Empty State 로 그리지 않고 오류 모달 + `<ErrorState />` 로 처리한다.

```python
# 알릴 게 있는 변경
return success_response(_room_out(room), message="대화 제목을 수정했습니다.")
# 단순 조회 — 토스트 없음
return success_response(page)
# 실패 — 모달로 간다
raise AppError("대화를 찾을 수 없습니다", "이미 삭제되었거나 존재하지 않는 대화입니다.", 404)
```

> 이런 공통 정책(응답 구조·에러 처리·네이밍·설계 원칙)이 바뀌면 **기능만 고치지 말고 이 문서도 함께 갱신한다.**

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
