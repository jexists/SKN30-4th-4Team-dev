from dataclasses import dataclass

from app.inference.types import BBox, TextRegion
from app.masking.detector import PiiMatch


@dataclass(frozen=True)
class MaskRegion:
    page_index: int
    bbox: BBox
    reason: str
    coarse: bool


def map_match_to_region(region: TextRegion, match: PiiMatch) -> MaskRegion:
    """개인정보 문자열을 좌표로 바꾼다.

    v1.6 Spotting이 반환한 텍스트 영역 안에서 정확한 글자별 좌표는 제공되지
    않으므로 개인정보가 포함된 영역 전체를 가린다. 누락보다 과다 마스킹을
    택한 보수적 fallback이다.
    """
    return MaskRegion(region.page_index, region.bbox, match.pii_type.value, coarse=True)
