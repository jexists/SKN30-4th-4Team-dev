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

OCR worker:
```bash
cd ocr-worker
uv sync
cp .env.example .env          # Windows(PowerShell): Copy-Item .env.example .env
```

`ocr-worker/.env`의 `OCR_VL_MODEL_DIR`에는 로컬 PaddleOCR-VL 모델 경로를 지정합니다.

## 2. 실행 (개발) — 터미널 3개

OCR worker:
```bash
cd ocr-worker
uv run uvicorn app.main:app --reload --port 8100
# → http://localhost:8100/health
```

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
# → http://localhost:5173/analyze
```

`/analyze`에서는 임대차계약서를 포함한 계약 서류 묶음이 필수이고, 등기부등본은
선택입니다. PDF·JPG·PNG를 파일당 20MB, PDF 20쪽까지 처리합니다.

## 3. Docker로 한 번에 (선택)
```bash
docker compose up --build
# 프론트 http://localhost:5173 · 백엔드 http://localhost:8000 · OCR worker http://localhost:8100
```

## 4. 테스트 / 린트
```bash
cd backend  && uv run pytest         # 백엔드 테스트
cd ocr-worker && uv run pytest       # OCR worker 테스트
cd frontend && npm run test          # 프론트 테스트
cd frontend && npm run lint          # 프론트 린트
```

> **Mac ↔ Windows 차이는 두 가지뿐**: `.env` 복사(`cp` ↔ `Copy-Item`)와 명령 연결(`&&` ↔ PowerShell `;`).
> `uv`·`npm`·`docker` 명령 자체는 동일합니다.
