from pathlib import Path
from typing import Protocol

from app.inference.types import ParsedPage


class DocumentOcrEngine(Protocol):
    def parse_document(self, path: Path) -> list[ParsedPage]: ...

    def parse_page(self, path: Path, page_index: int) -> ParsedPage: ...

    def spot_page(self, path: Path, page_index: int) -> ParsedPage: ...
