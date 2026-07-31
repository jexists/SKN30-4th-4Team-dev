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


def order_regions(regions: Iterable[TextRegion]) -> list[TextRegion]:
    """레이아웃 읽기 순서가 있으면 우선하고, 없으면 위→아래·왼쪽→오른쪽으로 정렬한다."""
    items = list(regions)
    if any(region.block_order is not None for region in items):
        return sorted(
            items,
            key=lambda region: (
                region.block_order is None,
                region.block_order if region.block_order is not None else 0,
                region.bbox[1],
                region.bbox[0],
            ),
        )

    # Spotting 좌표는 같은 행이어도 y가 몇 픽셀씩 흔들린다. raw y만 정렬하면 오른쪽 값이
    # 왼쪽 라벨보다 먼저 올 수 있으므로, 세로 중심이 가까운 영역을 한 줄로 묶은 뒤 x로 정렬한다.
    lines: list[list[TextRegion]] = []
    for region in sorted(items, key=lambda item: ((item.bbox[1] + item.bbox[3]) / 2, item.bbox[0])):
        center_y = (region.bbox[1] + region.bbox[3]) / 2
        height = max(1.0, region.bbox[3] - region.bbox[1])
        target_line = None
        for line in reversed(lines):
            line_center = sum((item.bbox[1] + item.bbox[3]) / 2 for item in line) / len(line)
            line_height = max(max(1.0, item.bbox[3] - item.bbox[1]) for item in line)
            if abs(center_y - line_center) <= max(8.0, min(height, line_height) * 0.5):
                target_line = line
                break
            if center_y > line_center + line_height:
                break
        if target_line is None:
            lines.append([region])
        else:
            target_line.append(region)

    ordered: list[TextRegion] = []
    for line in sorted(lines, key=lambda value: min(item.bbox[1] for item in value)):
        ordered.extend(sorted(line, key=lambda item: item.bbox[0]))
    return ordered
