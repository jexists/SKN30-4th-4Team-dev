# backend — FastAPI (uv, Python 3.12)

전·월세 분쟁 팩트체커 백엔드 API. 상세 규칙은 [`CLAUDE.md`](./CLAUDE.md), 첫 설정·실행은 [`../docs/setup.md`](../docs/setup.md) 참고.

## 첫 설정

```bash
uv sync                       # 의존성 설치 + .venv
cp .env.example .env          # Windows(PowerShell): Copy-Item .env.example .env
```

## 실행

```bash
uv run uvicorn app.main:app --reload --port 8000
# → http://localhost:8000        (API 문서: http://localhost:8000/docs)
# → http://localhost:8000/api/v1/health  로 DB 연결까지 확인
```

## 테스트 / 린트

```bash
uv run pytest        # 테스트 (+ pytest-cov)
uv run ruff check .  # 린트
uv run ruff format . # 포맷
```

## 구조

```
app/
├── main.py       # 앱 생성, CORS·에러핸들러·로깅 등록, 라우터(/api/v1)
├── api/          # 엔드포인트(routes/) + 공통 의존성(deps.py: get_current_user)
├── core/         # config·logging·exceptions·security(JWT 검증 스텁)
├── db/           # base(DeclarativeBase)·session(get_db)  ← Supabase Postgres
├── models/       # ERD = ORM 모델 (지금은 빈 패키지)
├── schemas/      # Pydantic (common.py = 표준 응답 봉투, health.py)
└── services/     # ingestion(청킹·임베딩·색인) / retrieval(검색) — 자리표시
pipeline/         # 오프라인 배치 색인 러너 (data/ → Supabase)
tests/            # pytest (conftest.py = 인메모리 SQLite 픽스처)
```

- **응답**: 모든 엔드포인트는 표준 봉투 `ApiResponse`(`success`·`code`·`message`·`data`·`error`)로 응답.

## 환경변수

`.env.example` 을 `.env` 로 복사해 채웁니다. 기본값·상세는 [`app/core/config.py`](app/core/config.py).

| 키 | 설명 |
| --- | --- |
| `APP_DB_URL` | 앱 데이터 DB (`chat_room`·`chat_message`, SQLAlchemy ORM) |
| `RAG_DB_URL` | 임베딩 검색 DB (`legal_chunks`, pgvector). 비우면 `APP_DB_URL` 재사용 |
| `CORS_ORIGINS` | 허용 origin, 쉼표 구분 |
| `SUPABASE_URL` | 프로젝트 URL. JWKS 공개키 출처로도 쓰임 (비밀값 아님) |
| `SUPABASE_KEY` | service role 키 |
| `SUPABASE_JWT_SECRET` | HS256(레거시) 검증용. 비대칭키 프로젝트면 불필요 |
| `OPENAI_API_KEY` | LLM 호출용 |

걸리기 쉬운 것 셋:

1. **`APP_DB_URL` 은 `postgresql+psycopg://` 접두사를 직접 써야 합니다.** 정규화 없이 `create_engine` 에 넘어가는데 의존성에 psycopg v3 만 있어서, `postgresql://` 로 두면 psycopg2 를 찾다가 기동에 실패합니다. (`RAG_DB_URL` 은 자동 정규화되니 아무 형식이나 OK.)
2. **`APP_DB_URL` 이 SQLite 면 서버는 뜨지만 대화 기록 API 가 전부 503(`HISTORY_UNAVAILABLE`)** 입니다. 채팅 기록을 쓰려면 Postgres 로 지정하세요.
3. **RAG DB 가 없으면 검색이 조용히 꺼집니다** — 에러 없이 빈 결과를 돌려주고 근거 없는 답변이 나가므로 알아채기 어렵습니다.

JWT 검증은 비대칭키(ES256/RS256, 최근 Supabase 기본)면 `SUPABASE_URL` 만으로 충분하고, 대칭키(HS256)면 `SUPABASE_JWT_SECRET` 이 필요합니다. 둘 다 없으면 보호 엔드포인트가 전부 401 이 됩니다. 어느 쪽으로 동작 중인지는 기동 로그의 `JWT 검증 모드: ...` 한 줄로 확인하세요.
