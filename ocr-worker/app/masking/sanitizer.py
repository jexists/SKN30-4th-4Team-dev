from dataclasses import dataclass, field

from app.masking.detector import PiiMatch
from app.masking.patterns import PiiType

PLACEHOLDERS: dict[PiiType, str] = {
    PiiType.RESIDENT_REGISTRATION_NUMBER: "[주민등록번호]",
    PiiType.PHONE_NUMBER: "[전화번호]",
    PiiType.EMAIL: "[이메일]",
    PiiType.BANK_ACCOUNT: "[계좌번호]",
    PiiType.NAME: "[이름]",
}


@dataclass(frozen=True)
class SanitizedText:
    text: str
    redaction_counts: dict[str, int] = field(default_factory=dict)


def sanitize_text(text: str, matches: list[PiiMatch]) -> SanitizedText:
    """탐지된 값만 플레이스홀더로 바꾸며 원문 값은 결과에 남기지 않는다."""
    parts: list[str] = []
    counts: dict[str, int] = {}
    cursor = 0

    for match in sorted(matches, key=lambda item: (item.start, item.end)):
        # 서로 겹치는 정규식 결과는 먼저 시작한 한 건만 사용한다.
        if match.start < cursor:
            continue
        parts.append(text[cursor : match.start])
        parts.append(PLACEHOLDERS[match.pii_type])
        cursor = match.end
        key = match.pii_type.value
        counts[key] = counts.get(key, 0) + 1

    parts.append(text[cursor:])
    return SanitizedText(text="".join(parts), redaction_counts=counts)
