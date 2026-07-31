from pathlib import Path

from PIL import Image, ImageDraw

from app.core.config import Settings
from app.inference.types import ParsedPage, TextRegion
from app.pipeline.contract_pipeline import ContractProcessingPipeline


class FakeStructuredEngine:
    def __init__(self):
        self.parse_calls = 0
        self.spot_calls = 0

    def parse_document(self, path: Path) -> list[ParsedPage]:
        return [self.parse_page(path, 0)]

    def parse_page(self, path: Path, page_index: int) -> ParsedPage:
        self.parse_calls += 1
        return ParsedPage(
            page_index,
            200,
            200,
            [
                TextRegion(page_index, "보증금 1억원", (10, 60, 180, 80), block_order=2),
                TextRegion(page_index, "임차인: 홍길동", (10, 20, 180, 40), block_order=1),
            ],
        )

    def spot_page(self, path: Path, page_index: int) -> ParsedPage:
        self.spot_calls += 1
        # 마스킹된 이미지 재검증에서는 개인정보가 검출되지 않는 것으로 모사한다.
        if path.name.startswith("masked_"):
            return ParsedPage(page_index, 200, 200, [])
        return ParsedPage(
            page_index,
            200,
            200,
            [TextRegion(page_index, "임차인: 홍길동", (10, 20, 180, 40), label="spotting")],
        )


def test_pipeline_separates_parsing_text_from_spotting_masks(tmp_path: Path):
    source = tmp_path / "contract.png"
    image = Image.new("RGB", (200, 200), "white")
    ImageDraw.Draw(image).rectangle((10, 20, 180, 40), fill="gray")
    image.save(source)
    output = tmp_path / "masked.pdf"
    engine = FakeStructuredEngine()
    pipeline = ContractProcessingPipeline(
        engine,
        Settings(
            OCR_AUTO_CROP=False,
            OCR_AUTO_CONTRAST=False,
            OCR_MAX_IMAGE_LONG_EDGE=1000,
        ),
    )

    result = pipeline.process(source, tmp_path / "work", output)

    assert engine.parse_calls == 1
    assert engine.spot_calls == 2  # 원본 좌표 + 마스킹 잔존 검증
    assert result.sanitized_text.index("임차인: [이름]") < result.sanitized_text.index("보증금")
    assert "홍길동" not in result.sanitized_text
    assert result.redaction_counts == {"name": 1}
    assert result.mask_count == 1
    assert output.read_bytes().startswith(b"%PDF")
