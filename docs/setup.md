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

## 2. 실행 (개발) — 터미널 2개

백엔드:
```bash
cd backend
uv run uvicorn app.main:app --reload --port 8000
# → http://localhost:8000   (API 문서: /docs, 헬스체크: /api/v1/health)
```

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
