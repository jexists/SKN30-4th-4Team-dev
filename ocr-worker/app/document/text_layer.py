from pathlib import Path

from app.inference.types import ParsedPage, TextRegion


def extract_text_layer_pages(input_path: Path, dpi: int) -> dict[int, ParsedPage]:
    """PDF 텍스트층을 렌더 이미지와 같은 픽셀 좌표계로 변환한다."""
    if input_path.suffix.lower() != ".pdf":
        return {}

    import fitz

    scale = dpi / 72
    document = fitz.open(input_path)
    pages: dict[int, ParsedPage] = {}
    try:
        for page_index, page in enumerate(document):
            regions: list[TextRegion] = []
            for block_index, block in enumerate(page.get_text("blocks", sort=True)):
                x1, y1, x2, y2, text, *_ = block
                normalized = str(text).strip()
                if not normalized:
                    continue
                regions.append(
                    TextRegion(
                        page_index=page_index,
                        text=normalized,
                        bbox=(x1 * scale, y1 * scale, x2 * scale, y2 * scale),
                        label="text",
                        block_id=block_index,
                        block_order=block_index,
                        confidence=1.0,
                    )
                )

            visible_text = "".join(region.text.split() for region in regions)
            if len(visible_text) < 8:
                continue
            pages[page_index] = ParsedPage(
                page_index=page_index,
                width=round(page.rect.width * scale),
                height=round(page.rect.height * scale),
                regions=regions,
            )
    finally:
        document.close()
    return pages
