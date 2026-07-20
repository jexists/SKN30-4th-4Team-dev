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

- **DB**: 기본은 SQLite 폴백으로 바로 실행. `.env` 의 `DATABASE_URL` 을 Supabase Postgres 로 바꾸면 그걸로 전환.
- **응답**: 모든 엔드포인트는 표준 봉투 `ApiResponse`(`success`·`code`·`message`·`data`·`error`)로 응답.
