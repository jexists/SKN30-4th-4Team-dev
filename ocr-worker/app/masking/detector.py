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
    _name_with_context = re.compile(
        r"(?:임대인|임차인|성명|이름|예금주)\s*[:：]?\s*"
        r"(?P<value>(?!(?:주민번호|연락처|전화번호|주소|소재지|계좌번호|은행명))[가-힣]{2,5})"
    )
    _address_with_context = re.compile(
        r"(?<!\[)(?:주소|소재지)(?!\s*[:：]?\s*\[주소\])\s*[:：]?\s*(?P<value>.{5,120}?)(?=$|\s+(?:전화|연락처|주민|계좌|"
        r"임대인|임차인|성명|이름)\s*[:：])"
    )

    def detect(self, text: str) -> list[PiiMatch]:
        matches: list[PiiMatch] = []
        for pii_type, pattern in PATTERNS.items():
            if pii_type is PiiType.BANK_ACCOUNT and not self._account_context.search(text):
                continue
            for match in re.finditer(pattern, text):
                matches.append(PiiMatch(pii_type, match.group(), match.start(), match.end()))
        for pii_type, pattern in (
            (PiiType.NAME, self._name_with_context),
            (PiiType.ADDRESS, self._address_with_context),
        ):
            for match in pattern.finditer(text):
                start, end = match.span("value")
                matches.append(PiiMatch(pii_type, match.group("value"), start, end))
        return sorted(matches, key=lambda item: (item.start, item.end))
