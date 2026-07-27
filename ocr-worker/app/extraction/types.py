from dataclasses import dataclass

from app.extraction.schemas import ExtractionMethod
from app.inference.types import ParsedPage


@dataclass(frozen=True)
class RecognizedPage:
    parsed: ParsedPage
    method: ExtractionMethod
