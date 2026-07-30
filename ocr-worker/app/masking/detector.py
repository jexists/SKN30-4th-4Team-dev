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
        r"(?:임대인|임차인|소유자|성명|이름|예금주)\s*[:：]?\s*"
        r"(?P<value>(?!(?:주민번호|연락처|전화번호|주소|소재지|계좌번호|은행명))[가-힣]{2,5})"
    )

    def detect(self, text: str) -> list[PiiMatch]:
        matches: list[PiiMatch] = []
        for pii_type, pattern in PATTERNS.items():
            if pii_type is PiiType.BANK_ACCOUNT and not self._account_context.search(text):
                continue
            for match in re.finditer(pattern, text):
                matches.append(PiiMatch(pii_type, match.group(), match.start(), match.end()))
        for match in self._name_with_context.finditer(text):
            start, end = match.span("value")
            matches.append(PiiMatch(PiiType.NAME, match.group("value"), start, end))
        return sorted(matches, key=lambda item: (item.start, item.end))

    def detect_region(self, text: str, previous_text: str = "") -> list[PiiMatch]:
        """현재 OCR 영역의 개인정보를 바로 앞 영역의 문맥까지 이용해 탐지한다.

        PaddleOCR-VL Spotting은 표의 라벨과 값을 별도 영역으로 반환할 수 있다.
        ``임대인`` 다음 영역의 ``김가상``처럼 값만 있는 영역도 마스킹하되,
        반환 좌표는 현재 영역 문자열 기준으로 유지한다.
        """
        if not previous_text:
            return self.detect(text)

        prefix = f"{previous_text}\n"
        combined = prefix + text
        offset = len(prefix)
        return [
            PiiMatch(match.pii_type, match.text, match.start - offset, match.end - offset)
            for match in self.detect(combined)
            if match.start >= offset and match.end <= len(combined)
        ]
