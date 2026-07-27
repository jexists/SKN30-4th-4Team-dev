from app.masking.detector import PiiDetector
from app.masking.patterns import PiiType


def test_detects_core_contract_pii():
    text = "임차인 주민번호 900101-1234567 연락처 010-1234-5678 test@example.com"

    matches = PiiDetector().detect(text)

    assert {match.pii_type for match in matches} == {
        PiiType.RESIDENT_REGISTRATION_NUMBER,
        PiiType.PHONE_NUMBER,
        PiiType.EMAIL,
    }


def test_account_number_requires_context():
    detector = PiiDetector()

    assert not detector.detect("계약일 2026-07-23")
    matches = detector.detect("입금 계좌 123-456-789012")
    assert any(match.pii_type is PiiType.BANK_ACCOUNT for match in matches)


def test_detects_contextual_name_and_address():
    matches = PiiDetector().detect("임차인: 홍길동 주소: 서울특별시 강남구 테헤란로 1")

    values = {(match.pii_type, match.text) for match in matches}
    assert (PiiType.NAME, "홍길동") in values
    assert (PiiType.ADDRESS, "서울특별시 강남구 테헤란로 1") in values
