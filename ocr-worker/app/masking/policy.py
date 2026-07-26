from dataclasses import dataclass

from app.masking.patterns import PiiType


@dataclass(frozen=True)
class MaskingPolicy:
    pii_types: frozenset[PiiType] = frozenset(PiiType)
    mask_seal_regions: bool = True
    margin_px: int = 4
