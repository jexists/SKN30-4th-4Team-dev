from collections.abc import Iterable
from typing import Any

from app.inference.types import BBox, ParsedPage, TextRegion


def unwrap_result(payload: dict[str, Any]) -> dict[str, Any]:
    wrapped = payload.get("res")
    return wrapped if isinstance(wrapped, dict) else payload


def _as_sequence(raw: Any) -> Any:
    """PaddleX 결과에 남아 있는 NumPy 배열을 일반 시퀀스로 바꾼다."""
    tolist = getattr(raw, "tolist", None)
    return tolist() if callable(tolist) else raw


def parse_bbox(raw: Any) -> BBox:
    raw = _as_sequence(raw)
    if (
        isinstance(raw, (list, tuple))
        and len(raw) == 4
        and all(isinstance(value, (int, float)) for value in raw)
    ):
        x1, y1, x2, y2 = raw
        return float(x1), float(y1), float(x2), float(y2)

    if isinstance(raw, (list, tuple)) and raw:
        points: Iterable[Any] = raw
        normalized = [_as_sequence(point) for point in points]
        valid = [
            point
            for point in normalized
            if isinstance(point, (list, tuple))
            and len(point) >= 2
            and isinstance(point[0], (int, float))
            and isinstance(point[1], (int, float))
        ]
        if valid:
            xs = [float(p[0]) for p in valid]
            ys = [float(p[1]) for p in valid]
            return min(xs), min(ys), max(xs), max(ys)
    raise ValueError("지원하지 않는 PaddleOCR-VL 좌표 형식입니다.")


def parse_result(payload: dict[str, Any], default_page_index: int = 0) -> ParsedPage:
    data = unwrap_result(payload)
    page_index = data.get("page_index")
    page_index = default_page_index if page_index is None else int(page_index)
    width = int(data.get("width") or 0)
    height = int(data.get("height") or 0)
    regions: list[TextRegion] = []

    for index, block in enumerate(data.get("parsing_res_list") or []):
        if not isinstance(block, dict) or not block.get("block_content"):
            continue
        regions.append(
            TextRegion(
                page_index=page_index,
                text=str(block["block_content"]),
                bbox=parse_bbox(block.get("block_bbox")),
                label=str(block.get("block_label") or "text"),
                block_id=block.get("block_id", index),
                block_order=block.get("block_order"),
            )
        )
    return ParsedPage(page_index=page_index, width=width, height=height, regions=regions)
