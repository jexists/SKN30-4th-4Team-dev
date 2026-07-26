from dataclasses import dataclass, field

BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class TextRegion:
    page_index: int
    text: str
    bbox: BBox
    label: str = "text"
    block_id: int | None = None
    block_order: int | None = None
    # PaddleOCR-VL은 일반 OCR처럼 안정적인 confidence를 제공하지 않는다.
    confidence: float | None = None


@dataclass(frozen=True)
class ParsedPage:
    page_index: int
    width: int
    height: int
    regions: list[TextRegion] = field(default_factory=list)
