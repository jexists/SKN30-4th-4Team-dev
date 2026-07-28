# 시작 가이드 (Setup)

Mac·Windows 공통. `uv`·`npm`·`docker` 는 크로스플랫폼이라 명령어가 거의 동일합니다.

## 사전 준비
- Python 3.12, [uv](https://docs.astral.sh/uv/), Node.js 20+, npm
- (선택) Docker Desktop

## 1. 첫 설정 (한 번만)

백엔드:
```bash
cd backend
uv sync                       # 의존성 설치 + .venv 생성
cp .env.example .env          # Windows(PowerShell): Copy-Item .env.example .env
```

프론트엔드:
```bash
cd frontend
npm install
cp .env.example .env          # Windows(PowerShell): Copy-Item .env.example .env
```

### DB 연결 문자열 (backend/.env)

Supabase Dashboard → **Connect** 에서 목적에 맞는 URI 를 복사합니다. 포트만 바꾸지 말고
Dashboard 가 주는 전체 URI 를 쓰세요.

| 키 | Dashboard 항목 | 용도 |
| --- | --- | --- |
| `APP_DB_URL` | **Transaction pooler** (보통 `:6543`) | API 런타임 |
| `RAG_DB_URL` | — (비워 둠) | `APP_DB_URL` 재사용 |
| `INGEST_DATABASE_URL` | **Direct connection** (IPv6 불가 시 Session pooler) | 색인·DDL 배치 |

> ⚠️ 런타임에 **Session pooler(`:5432`)** 를 쓰면 안 됩니다. 클라이언트 수가 Pool Size(기본 15)로
> 제한돼, 팀원 서너 명이 동시에 로컬 서버를 띄우는 것만으로
> `FATAL: (EMAXCONNSESSION) max clients reached in session mode` 가 납니다.
> (로컬 Postgres 를 직접 띄워 쓸 때의 `:5432` 는 무관합니다.)

프로세스 하나가 잡는 커넥션 상한은 기본 **7개**입니다. 자세한 예산 계산은
[`backend/README.md`](../backend/README.md) 의 "커넥션 예산" 참고.

## 2. 실행 (개발) — 터미널 2개

백엔드:
```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
# → http://localhost:8000   (API 문서: /docs, 헬스체크: /api/v1/health)
```

첫 실행에서는 임베딩 모델(KURE-v1, 약 2GB)을 백그라운드로 내려받아 워밍업하므로 준비에
시간이 걸릴 수 있지만 서버와 헬스체크는 즉시 응답합니다. 백엔드 저장이 잦은 개발 중에는
`.env`의 `WARMUP_ON_STARTUP=false`로 워밍업을 끌 수 있습니다.

프론트엔드:
```bash
cd frontend
npm run dev
# → http://localhost:5173   (하단에 "백엔드 연결됨" 초록불 확인)
```

## 3. Docker로 한 번에 (선택)
```bash
docker compose up --build
# 프론트 http://localhost:5173 · 백엔드 http://localhost:8000
```

## 4. 테스트 / 린트
```bash
cd backend  && uv run pytest         # 백엔드 테스트
cd frontend && npm run test          # 프론트 테스트
cd frontend && npm run lint          # 프론트 린트
```

> **Mac ↔ Windows 차이는 두 가지뿐**: `.env` 복사(`cp` ↔ `Copy-Item`)와 명령 연결(`&&` ↔ PowerShell `;`).
> `uv`·`npm`·`docker` 명령 자체는 동일합니다.
