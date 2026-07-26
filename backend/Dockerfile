# uv + Python 3.12 공식 이미지
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# 의존성 먼저 설치 (레이어 캐시 활용). lockfile 을 함께 복사하고 --frozen 으로 고정한다 —
# 없으면 COPY . . 로 들어온 uv.lock 때문에 컨테이너 시작 시 uv run 이 torch 를 재설치한다.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

# HuggingFace 모델 캐시 위치(/models/hub) — compose 의 named volume 과 짝을 이룬다.
# 지정하지 않으면 컨테이너를 다시 만들 때마다 KURE-v1(~2GB) 을 다시 내려받는다.
ENV HF_HOME=/models
# 진행률 바는 백그라운드 스레드에서 로그와 뒤섞이므로 끈다.
ENV HF_HUB_DISABLE_PROGRESS_BARS=1

EXPOSE 8000
CMD ["uv", "run", "--frozen", "--no-dev", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
