from enum import StrEnum


class PiiType(StrEnum):
    RESIDENT_REGISTRATION_NUMBER = "resident_registration_number"
    PHONE_NUMBER = "phone_number"
    EMAIL = "email"
    BANK_ACCOUNT = "bank_account"
    NAME = "name"


PATTERNS: dict[PiiType, str] = {
    PiiType.RESIDENT_REGISTRATION_NUMBER: r"(?<!\d)\d{6}\s*[-–—]?\s*[1-8]\d{6}(?!\d)",
    PiiType.PHONE_NUMBER: r"(?<!\d)(?:0\d{1,2})\s*[-.)]?\s*\d{3,4}\s*[-.]?\s*\d{4}(?!\d)",
    PiiType.EMAIL: r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
    # 계좌번호는 단독 숫자 오탐이 많아 은행/계좌 문맥이 있는 경우 detector에서만 적용한다.
    PiiType.BANK_ACCOUNT: r"\d{2,6}(?:\s*[-–—]\s*\d{2,6}){2,4}",
}
