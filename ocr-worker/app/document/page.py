from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PageImage:
    index: int
    path: Path
    width: int
    height: int
