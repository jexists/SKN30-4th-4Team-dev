# 백엔드와 같은 uv 공식 이미지 — 파이썬·uv 버전을 프로젝트 전체에서 맞춘다.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# tesseract-ocr / -kor: OCR_PROVIDER=tesseract 경로가 호출하는 실행 파일과 한국어 학습 데이터.
#   기본 언어 설정이 kor+eng 라 kor 팩이 없으면 첫 처리 요청에서 바로 죽는다.
# libgl1 / libglib2.0-0: paddleocr 가 끌어오는 opencv 의 런타임 의존성.
#   slim 이미지에는 없어서 import 단계에서 libGL.so.1 을 찾지 못한다.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-kor \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# 의존성 먼저 설치 (레이어 캐시 활용). lockfile 을 함께 복사하고 --frozen 으로 고정한다 —
# 없으면 컨테이너 시작 시 uv run 이 의존성을 다시 해석해 torch 를 재설치한다.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

# 모델 캐시 위치(/cache) — compose 의 named volume 과 짝을 이룬다. 지정하지 않으면
# 컨테이너를 다시 만들 때마다 모델을 다시 내려받는다. 미리 받아 둔 PaddleOCR-VL
# 스냅샷은 /models 에 읽기 전용으로 마운트되므로 캐시 경로와 분리한다.
ENV HF_HOME=/cache
# 진행률 바는 백그라운드 스레드에서 로그와 뒤섞이므로 끈다.
ENV HF_HUB_DISABLE_PROGRESS_BARS=1

EXPOSE 8100
CMD ["uv", "run", "--frozen", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
