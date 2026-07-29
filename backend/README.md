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
| `APP_DB_URL` | 런타임 DB (`chat_room`·`chat_message`, SQLAlchemy ORM). **Transaction pooler URI(:6543)** |
| `RAG_DB_URL` | 임베딩 검색 DB (`legal_chunks`, pgvector). 비우면 `APP_DB_URL` 재사용 |
| `INGEST_DATABASE_URL` | 색인·DDL 전용(`test/ingest_kure.py`). Direct 또는 Session pooler URI |
| `DB_POOL_SIZE`·`DB_MAX_OVERFLOW` | SQLAlchemy 풀 상한 (기본 3+2) |
| `RAG_POOL_MAX_SIZE` | RAG 검색용 psycopg 풀 상한 (기본 2) |
| `WARMUP_ON_STARTUP` | 기동 시 임베딩 모델·챗봇 엔진 백그라운드 워밍업 여부 (기본 `true`) |
| `CORS_ORIGINS` | 허용 origin, 쉼표 구분 |
| `SUPABASE_URL` | 프로젝트 URL. JWKS 공개키 출처로도 쓰임 (비밀값 아님) |
| `SUPABASE_KEY` | service role 키 |
| `SUPABASE_JWT_SECRET` | HS256(레거시) 검증용. 비대칭키 프로젝트면 불필요 |
| `OPENAI_API_KEY` | LLM 호출용 |
| `OCR_WORKER_URL` | 로컬 OCR worker 주소. 로컬 직접 실행 시 `http://127.0.0.1:8100` |
| `OCR_WORKER_PROCESS_TIMEOUT_SECONDS` | 계약서 OCR 요청 제한 시간(초) |
| `CONTRACT_MAX_FILES` | 한 번에 종합 분석할 수 있는 서류 수(기본 3개) |
| `CONTRACT_MAX_FILE_MB` | 업로드 가능한 계약서 최대 크기 |
| `CONTRACT_ANALYSIS_MODEL` | 개인정보 치환 텍스트를 분석할 LLM 모델 |

## 계약서 분석 API

`POST /api/v1/documents/analyze`는 인증이 필요한 multipart 업로드 API입니다.
같은 `file` 필드를 반복하면 최대 `CONTRACT_MAX_FILES`개의 서류를 전달할 수 있습니다.
백엔드는 모든 서류를 OCR worker로 순차 처리하고, 문서별로 구분한 개인정보 치환
텍스트만 한 번의 종합 분석 입력으로 사용합니다. 원본 OCR 텍스트와 마스킹 PDF는
LLM 입력에 포함되지 않습니다. 응답의 `documents`에는 문서별 마스킹 결과가 있으며,
기존 최상위 마스킹 PDF 필드는 단일 파일 클라이언트 호환을 위해 첫 번째 결과를
담습니다. 현재 base64 응답은 PoC용이며 운영 저장 방식은 private Storage로 교체해야
합니다.

걸리기 쉬운 것 다섯:

1. **`APP_DB_URL` 은 Supabase Dashboard → Connect → *Transaction pooler* 의 URI 를 씁니다(보통 `:6543`).** Session pooler(`:5432`)는 클라이언트 수가 Pool Size(기본 15)로 제한돼, 팀원 여러 명이 각자 로컬 서버를 띄우면 `EMAXCONNSESSION`(`max clients reached in session mode`)이 납니다. 포트만 치환하지 말고 Dashboard 가 주는 전체 URI 를 복사하세요. (로컬 Postgres 의 `:5432` 는 정상입니다 — 제한은 Supabase pooler 얘기입니다.)
2. **`APP_DB_URL` 이 SQLite 면 서버는 뜨지만 대화 기록 API 가 전부 503("대화 기록 사용 불가")** 입니다. 채팅 기록을 쓰려면 Postgres 로 지정하세요.
3. **RAG DB 가 없으면 검색이 조용히 꺼집니다** — 에러 없이 빈 결과를 돌려주고 근거 없는 답변이 나가므로 알아채기 어렵습니다.
4. **첫 기동은 모델(~2GB) 다운로드로 워밍업이 오래 걸리지만 서버·헬스체크는 즉시 응답합니다.** 백엔드 저장이 잦은 개발 중에는 `WARMUP_ON_STARTUP=false` 로 끌 수 있습니다.
5. **색인(`test/ingest_kure.py`)은 `INGEST_DATABASE_URL` 이 없으면 그냥 종료합니다.** 런타임 URL 로 조용히 fallback 하지 않습니다 — transaction pooler 로 DDL·대량 배치를 돌리지 않기 위해서입니다.

### 커넥션 예산

프로세스 하나가 잡는 Supabase 커넥션 상한은 **`(DB_POOL_SIZE + DB_MAX_OVERFLOW) + RAG_POOL_MAX_SIZE`**(기본 3+2+2 = 7)입니다. SQLAlchemy 엔진은 **하나**뿐이고(`app/db/session.py`), RAG 검색은 별도 psycopg 풀을 씁니다.

전체 예산은 접속 사용자 수가 아니라 **백엔드 프로세스 수** 기준입니다:

```text
(운영 replica × worker 수 + 실행 중인 로컬 백엔드 수) × 7  ≤  Max Pooler Clients × 50%
```

풀 크기를 올리기 전에 이 식을 먼저 계산하세요. 커넥션이 모자라면 API 는 500 이 아니라 **503**("일시적인 접속 지연")을 돌려줍니다.

JWT 검증은 비대칭키(ES256/RS256, 최근 Supabase 기본)면 `SUPABASE_URL` 만으로 충분하고, 대칭키(HS256)면 `SUPABASE_JWT_SECRET` 이 필요합니다. 둘 다 없으면 보호 엔드포인트가 전부 401 이 됩니다. 어느 쪽으로 동작 중인지는 기동 로그의 `JWT 검증 모드: ...` 한 줄로 확인하세요.
