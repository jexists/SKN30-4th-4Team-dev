import sys
from pathlib import Path
from types import SimpleNamespace

from app.core.config import Settings
from app.inference.paddle_vl_engine import PaddleVlEngine


def test_layout_shape_mode_is_passed_to_predict_not_constructor(monkeypatch):
    calls: dict[str, dict] = {}

    class FakeResult:
        json = {
            "res": {
                "page_index": 0,
                "width": 100,
                "height": 100,
                "spotting_res": {
                    "rec_texts": ["전화번호 010-1234-5678"],
                    "rec_polys": [[[0, 0], [90, 0], [90, 20], [0, 20]]],
                },
            }
        }

    class FakePaddleOCRVL:
        def __init__(self, **kwargs):
            calls["init"] = kwargs

        def predict(self, _path, **kwargs):
            calls["predict"] = kwargs
            return [FakeResult()]

    monkeypatch.setitem(sys.modules, "paddleocr", SimpleNamespace(PaddleOCRVL=FakePaddleOCRVL))
    engine = PaddleVlEngine(
        Settings(
            OCR_VL_BACKEND="mlx-vlm-server",
            OCR_VL_SERVER_URL="http://127.0.0.1:8111/",
            OCR_VL_API_MODEL_NAME="/tmp/PaddleOCR-VL-1.6",
            OCR_VL_MODEL_DIR=Path("/tmp/PaddleOCR-VL-1.6"),
            OCR_LAYOUT_SHAPE_MODE="poly",
        )
    )

    page = engine.spot_page(Path("/tmp/input.png"), 0)

    assert "layout_shape_mode" not in calls["init"]
    assert calls["init"]["use_layout_detection"] is False
    assert calls["predict"]["layout_shape_mode"] == "poly"
    assert page.regions[0].text == "전화번호 010-1234-5678"
