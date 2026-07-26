import re
from dataclasses import dataclass

from app.masking.patterns import PATTERNS, PiiType


@dataclass(frozen=True)
class PiiMatch:
    pii_type: PiiType
    text: str
    start: int
    end: int


class PiiDetector:
    _account_context = re.compile(r"(?:계좌|은행|입금|예금주)", re.IGNORECASE)

    def detect(self, text: str) -> list[PiiMatch]:
        matches: list[PiiMatch] = []
        for pii_type, pattern in PATTERNS.items():
            if pii_type is PiiType.BANK_ACCOUNT and not self._account_context.search(text):
                continue
            for match in re.finditer(pattern, text):
                matches.append(PiiMatch(pii_type, match.group(), match.start(), match.end()))
        return sorted(matches, key=lambda item: (item.start, item.end))
