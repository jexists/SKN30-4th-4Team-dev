from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    OCR_MODEL_NAME: str = "PaddlePaddle/PaddleOCR-VL-1.6"
    OCR_PROVIDER: Literal["paddle_vl", "tesseract"] = "paddle_vl"
    OCR_PIPELINE_VERSION: str = "v1.6"
    OCR_ENGINE: Literal["paddle", "transformers"] = "transformers"
    OCR_DEVICE: str = "cpu"

    # Hugging Face snapshot 및 전체 파이프라인 보조 모델의 로컬 경로.
    # 비우면 pipeline_version에 맞는 공식 모델을 자동으로 내려받는다.
    OCR_VL_MODEL_DIR: Path | None = None
    OCR_LAYOUT_MODEL_DIR: Path | None = None
    OCR_ORIENTATION_MODEL_DIR: Path | None = None
    OCR_UNWARP_MODEL_DIR: Path | None = None

    # Apple Silicon에서 MLX-VLM 서버를 쓰는 경우에만 설정한다.
    OCR_VL_BACKEND: str = ""
    OCR_VL_SERVER_URL: str = ""
    OCR_VL_API_MODEL_NAME: str = ""

    OCR_USE_ORIENTATION: bool = True
    # AI 분석용 텍스트는 Spotting이 아니라 문서 레이아웃 Parsing 결과를 사용한다.
    OCR_USE_LAYOUT_DETECTION: bool = True
    # 내부 unwarping 결과 좌표를 원본에 역매핑하기 전까지는 기본 비활성화한다.
    OCR_USE_UNWARPING: bool = False
    OCR_USE_SEAL_RECOGNITION: bool = True
    OCR_LAYOUT_SHAPE_MODE: Literal["rect", "quad", "poly", "auto"] = "poly"

    OCR_MAX_FILE_MB: int = 20
    OCR_MAX_PAGES: int = 20
    OCR_RENDER_DPI: int = 250
    # 모델 입력이 지나치게 커져 내부에서 과도하게 축소되는 것을 막는다.
    OCR_MAX_IMAGE_LONG_EDGE: int = 3200
    # 실제 문서 바깥의 큰 흰 여백을 제거해 작은 글자가 모델 입력에서 차지하는 비율을 높인다.
    OCR_AUTO_CROP: bool = True
    OCR_CROP_THRESHOLD: int = 245
    OCR_CROP_PADDING_PX: int = 24
    OCR_AUTO_CONTRAST: bool = True
    OCR_MASK_MARGIN_PX: int = 4
    OCR_TESSERACT_LANG: str = "kor+eng"
    OCR_TESSERACT_PSM: int = 6

    # 공개 네트워크에 Worker를 배포할 때 사용하는 공유 비밀키.
    # 비어 있으면 로컬 개발 호환을 위해 인증을 요구하지 않는다.
    OCR_WORKER_API_KEY: str = ""
    # Serverless worker가 다운로드할 수 있는 유일한 호스트(예: abc.supabase.co).
    OCR_SOURCE_ALLOWED_HOST: str = ""
    OCR_SOURCE_DOWNLOAD_TIMEOUT_SECONDS: float = 30.0


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
