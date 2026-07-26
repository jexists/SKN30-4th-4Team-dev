from pathlib import Path
from typing import Protocol

from app.inference.types import ParsedPage


class DocumentOcrEngine(Protocol):
    def parse_document(self, path: Path) -> list[ParsedPage]: ...

    def spot_page(self, path: Path, page_index: int) -> ParsedPage: ...
