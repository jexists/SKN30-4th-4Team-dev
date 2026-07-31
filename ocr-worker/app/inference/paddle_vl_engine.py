from pathlib import Path
from threading import Lock
from typing import Any

from app.core.config import Settings
from app.inference.result_parser import parse_result
from app.inference.spotting_parser import parse_spotting_result
from app.inference.types import ParsedPage


class PaddleVlEngine:
    """PaddleOCR-VL-1.6 전체 파이프라인의 지연 로딩 어댑터."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self._pipeline: Any = None
        self._load_lock = Lock()

    @property
    def is_loaded(self) -> bool:
        return self._pipeline is not None

    def _get_pipeline(self):
        if self._pipeline is not None:
            return self._pipeline
        with self._load_lock:
            if self._pipeline is None:
                from paddleocr import PaddleOCRVL

                kwargs: dict[str, Any] = {
                    "pipeline_version": self.settings.OCR_PIPELINE_VERSION,
                    "device": self.settings.OCR_DEVICE,
                    "use_doc_orientation_classify": self.settings.OCR_USE_ORIENTATION,
                    "use_doc_unwarping": self.settings.OCR_USE_UNWARPING,
                    # 전체 Parsing 텍스트와 Spotting 좌표의 목적을 분리한다. Parsing에서는
                    # 레이아웃을 사용하고 Spotting 호출만 predict 인자로 끈다.
                    "use_layout_detection": self.settings.OCR_USE_LAYOUT_DETECTION,
                    "use_seal_recognition": self.settings.OCR_USE_SEAL_RECOGNITION,
                }
                if self.settings.OCR_VL_BACKEND:
                    kwargs.update(
                        vl_rec_backend=self.settings.OCR_VL_BACKEND,
                        vl_rec_server_url=self.settings.OCR_VL_SERVER_URL,
                        vl_rec_api_model_name=(
                            self.settings.OCR_VL_API_MODEL_NAME
                            or str(self.settings.OCR_VL_MODEL_DIR)
                        ),
                    )
                else:
                    kwargs["engine"] = self.settings.OCR_ENGINE
                    if self.settings.OCR_VL_MODEL_DIR:
                        kwargs["vl_rec_model_dir"] = str(self.settings.OCR_VL_MODEL_DIR)
                optional_dirs = {
                    "layout_detection_model_dir": self.settings.OCR_LAYOUT_MODEL_DIR,
                    "doc_orientation_classify_model_dir": self.settings.OCR_ORIENTATION_MODEL_DIR,
                    "doc_unwarping_model_dir": self.settings.OCR_UNWARP_MODEL_DIR,
                }
                kwargs.update({key: str(value) for key, value in optional_dirs.items() if value})
                self._pipeline = PaddleOCRVL(**kwargs)
        return self._pipeline

    @staticmethod
    def _payload(result: Any) -> dict[str, Any]:
        payload = result.json
        if not isinstance(payload, dict):
            raise ValueError("PaddleOCR-VL 결과가 JSON 객체가 아닙니다.")
        return payload

    def parse_document(self, path: Path) -> list[ParsedPage]:
        pipeline = self._get_pipeline()
        return [
            parse_result(self._payload(result), default_page_index=index)
            for index, result in enumerate(
                pipeline.predict(str(path), layout_shape_mode=self.settings.OCR_LAYOUT_SHAPE_MODE)
            )
        ]

    def parse_page(self, path: Path, page_index: int) -> ParsedPage:
        """AI 분석용 구조화 텍스트를 한 페이지에서 추출한다."""
        pipeline = self._get_pipeline()
        kwargs: dict[str, Any] = {
            "use_layout_detection": self.settings.OCR_USE_LAYOUT_DETECTION,
            "use_doc_unwarping": False,
            "format_block_content": False,
            "layout_shape_mode": self.settings.OCR_LAYOUT_SHAPE_MODE,
        }
        if not self.settings.OCR_USE_LAYOUT_DETECTION:
            # 레이아웃 모델을 명시적으로 끈 경량 환경에서도 Spotting 텍스트를 분석 본문으로
            # 재사용하지 않고 일반 OCR prompt를 사용한다.
            kwargs["prompt_label"] = "ocr"
        results = list(pipeline.predict(str(path), **kwargs))
        if len(results) != 1:
            raise ValueError("문서 Parsing은 페이지 이미지 하나당 결과 하나여야 합니다.")
        return parse_result(self._payload(results[0]), default_page_index=page_index)

    def spot_page(self, path: Path, page_index: int) -> ParsedPage:
        """픽셀 마스킹용 세부 텍스트 좌표를 추출한다."""
        pipeline = self._get_pipeline()
        results = list(
            pipeline.predict(
                str(path),
                use_layout_detection=False,
                prompt_label="spotting",
                use_doc_unwarping=False,
                layout_shape_mode=self.settings.OCR_LAYOUT_SHAPE_MODE,
            )
        )
        if len(results) != 1:
            raise ValueError("Spotting은 페이지 이미지 하나당 결과 하나여야 합니다.")
        return parse_spotting_result(self._payload(results[0]), page_index)
