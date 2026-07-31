from collections import defaultdict
from pathlib import Path

from app.core.config import Settings
from app.inference.types import ParsedPage, TextRegion


class TesseractEngine:
    """로컬 CPU 시연을 위한 Tesseract 글줄 단위 OCR 어댑터."""

    def __init__(self, settings: Settings):
        self.settings = settings

    @property
    def is_loaded(self) -> bool:
        # Tesseract는 요청마다 로컬 실행 파일을 호출하므로 상주 모델이 없다.
        return True

    def parse_document(self, path: Path) -> list[ParsedPage]:
        return [self.spot_page(path, 0)]

    def parse_page(self, path: Path, page_index: int) -> ParsedPage:
        return self.spot_page(path, page_index)

    def spot_page(self, path: Path, page_index: int) -> ParsedPage:
        import pytesseract
        from PIL import Image

        with Image.open(path) as source:
            image = source.convert("RGB")
            width, height = image.size
            data = pytesseract.image_to_data(
                image,
                lang=self.settings.OCR_TESSERACT_LANG,
                config=f"--psm {self.settings.OCR_TESSERACT_PSM}",
                output_type=pytesseract.Output.DICT,
            )

        lines: dict[tuple[int, int, int], list[int]] = defaultdict(list)
        for index, raw_text in enumerate(data["text"]):
            if str(raw_text).strip():
                key = (
                    int(data["block_num"][index]),
                    int(data["par_num"][index]),
                    int(data["line_num"][index]),
                )
                lines[key].append(index)

        regions: list[TextRegion] = []
        for indexes in lines.values():
            text = " ".join(str(data["text"][index]).strip() for index in indexes).strip()
            left = min(int(data["left"][index]) for index in indexes)
            top = min(int(data["top"][index]) for index in indexes)
            right = max(int(data["left"][index]) + int(data["width"][index]) for index in indexes)
            bottom = max(int(data["top"][index]) + int(data["height"][index]) for index in indexes)
            confidences = [
                float(data["conf"][index]) for index in indexes if float(data["conf"][index]) >= 0
            ]
            regions.append(
                TextRegion(
                    page_index=page_index,
                    text=text,
                    bbox=(float(left), float(top), float(right), float(bottom)),
                    label="text",
                    block_id=len(regions),
                    confidence=sum(confidences) / len(confidences) if confidences else None,
                )
            )
        return ParsedPage(page_index=page_index, width=width, height=height, regions=regions)
