from typing import Any

from app.inference.result_parser import parse_bbox, parse_result, unwrap_result
from app.inference.types import ParsedPage, TextRegion


def parse_spotting_result(payload: dict[str, Any], page_index: int) -> ParsedPage:
    """Spotting 결과를 공통 좌표 형식으로 바꾼다.

    PaddleOCR-VL 1.6의 Spotting 결과는 글자 영역을 ``spotting_res``의
    ``rec_texts``/``rec_polys``에 제공한다. 이 좌표를 우선 사용하고, 세부
    Spotting 결과가 없을 때만 블록 단위 ``parsing_res_list``로 대체한다.
    """
    data = unwrap_result(payload)
    raw_page_index = data.get("page_index")
    actual_page_index = page_index if raw_page_index is None else int(raw_page_index)
    width = int(data.get("width") or 0)
    height = int(data.get("height") or 0)
    raw_spotting = data.get("spotting_res")
    spotting_groups = raw_spotting if isinstance(raw_spotting, list) else [raw_spotting]
    regions: list[TextRegion] = []

    for group in spotting_groups:
        if not isinstance(group, dict):
            continue
        texts = group.get("rec_texts")
        texts = [] if texts is None else texts
        polygons = group.get("rec_polys")
        if polygons is None:
            polygons = group.get("rec_boxes")
        polygons = [] if polygons is None else polygons
        tolist = getattr(polygons, "tolist", None)
        polygons = tolist() if callable(tolist) else polygons
        tolist = getattr(texts, "tolist", None)
        texts = tolist() if callable(tolist) else texts
        if not isinstance(texts, (list, tuple)) or not isinstance(polygons, (list, tuple)):
            raise ValueError("PaddleOCR-VL Spotting 결과 형식이 올바르지 않습니다.")
        if len(texts) != len(polygons):
            raise ValueError("PaddleOCR-VL Spotting 텍스트와 좌표 개수가 다릅니다.")

        for text, polygon in zip(texts, polygons, strict=True):
            normalized_text = str(text).strip()
            if not normalized_text:
                continue
            regions.append(
                TextRegion(
                    page_index=actual_page_index,
                    text=normalized_text,
                    bbox=parse_bbox(polygon),
                    label="spotting",
                    block_id=len(regions),
                )
            )

    if regions:
        return ParsedPage(
            page_index=actual_page_index,
            width=width,
            height=height,
            regions=regions,
        )
    return parse_result(payload, default_page_index=page_index)
