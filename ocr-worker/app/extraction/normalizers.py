import re
from datetime import date

_KOREAN_DIGITS = {
    "영": 0,
    "공": 0,
    "일": 1,
    "이": 2,
    "삼": 3,
    "사": 4,
    "오": 5,
    "육": 6,
    "칠": 7,
    "팔": 8,
    "구": 9,
}
_SMALL_UNITS = {"십": 10, "백": 100, "천": 1_000}
_BIG_UNITS = {"만": 10_000, "억": 100_000_000, "조": 1_000_000_000_000}


def _number_token(raw: str) -> str:
    return re.sub(r"[^0-9.]", "", raw)


def _korean_integer(raw: str) -> int:
    total = 0
    section = 0
    digit: int | None = None

    for char in raw:
        if char in _KOREAN_DIGITS:
            digit = _KOREAN_DIGITS[char]
        elif char in _SMALL_UNITS:
            section += (1 if digit is None else digit) * _SMALL_UNITS[char]
            digit = None
        elif char in _BIG_UNITS:
            section += 0 if digit is None else digit
            total += (section or 1) * _BIG_UNITS[char]
            section = 0
            digit = None

    return total + section + (0 if digit is None else digit)


def normalize_money(raw: str) -> int:
    cleaned = re.sub(r"[,\s₩￦()]", "", raw)
    cleaned = re.sub(r"^금", "", cleaned)
    cleaned = re.sub(r"원(?:정)?$", "", cleaned)

    digits = re.findall(r"\d+", cleaned)
    if digits:
        return int("".join(digits))

    korean = re.sub(r"[^영공일이삼사오육칠팔구십백천만억조]", "", cleaned)
    if not korean:
        raise ValueError("금액을 정규화할 수 없습니다.")
    value = _korean_integer(korean)
    if value <= 0:
        raise ValueError("금액을 정규화할 수 없습니다.")
    return value


def normalize_date(raw: str) -> str:
    match = re.search(r"(?P<year>\d{4})\D+(?P<month>\d{1,2})\D+(?P<day>\d{1,2})", raw)
    if not match:
        raise ValueError("날짜를 정규화할 수 없습니다.")
    parsed = date(
        int(match.group("year")),
        int(match.group("month")),
        int(match.group("day")),
    )
    return parsed.isoformat()


def normalize_birth(raw: str) -> str:
    try:
        return normalize_date(raw)
    except ValueError:
        pass

    match = re.search(r"(?<!\d)(\d{2})(\d{2})(\d{2})\s*[-–—]?\s*([1-8])", raw)
    if not match:
        raise ValueError("생년월일을 정규화할 수 없습니다.")
    year, month, day, century_code = (int(value) for value in match.groups())
    century = 1900 if century_code in {1, 2, 5, 6} else 2000
    return date(century + year, month, day).isoformat()


def normalize_unit_no(raw: str) -> str:
    value = re.sub(r"[제호\s]", "", raw).upper()
    if not value:
        raise ValueError("호수를 정규화할 수 없습니다.")
    return value


def normalize_name(raw: str) -> str:
    value = re.sub(r"\([^)]*\)", "", raw)
    value = re.sub(r"\s+", "", value)
    if not value:
        raise ValueError("성명을 정규화할 수 없습니다.")
    return value


def normalize_registration_no(raw: str) -> str:
    groups = re.findall(r"[A-Za-z0-9]+", raw)
    if len(groups) < 2:
        raise ValueError("등록번호를 정규화할 수 없습니다.")
    return "-".join(groups).upper()


def normalize_area(raw: str) -> float:
    token = _number_token(raw)
    if not token:
        raise ValueError("면적을 정규화할 수 없습니다.")
    value = float(token)
    if "평" in raw:
        value *= 3.305785
    return round(value, 1)


def normalize_rate(raw: str) -> float:
    token = _number_token(raw)
    if not token:
        raise ValueError("요율을 정규화할 수 없습니다.")
    value = float(token)
    return value / 100 if "%" in raw else value


def normalize_text(raw: str) -> str:
    value = re.sub(r"\s+", " ", raw).strip(" \t:：-")
    if not value:
        raise ValueError("텍스트를 정규화할 수 없습니다.")
    return value


def normalize_account_number(raw: str) -> str:
    value = re.sub(r"\s+", "", raw)
    if not re.search(r"\d", value):
        raise ValueError("계좌번호를 정규화할 수 없습니다.")
    return value
