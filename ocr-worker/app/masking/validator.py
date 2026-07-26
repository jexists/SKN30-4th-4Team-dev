from app.inference.types import ParsedPage
from app.masking.detector import PiiDetector


def has_remaining_pii(pages: list[ParsedPage], detector: PiiDetector) -> bool:
    return any(detector.detect(region.text) for page in pages for region in page.regions)
