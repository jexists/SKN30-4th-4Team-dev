from app.masking.detector import PiiDetector, PiiMatch
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


def test_detects_contextual_name_but_keeps_address_for_document_comparison():
    matches = PiiDetector().detect("임차인: 홍길동 주소: 서울특별시 강남구 테헤란로 1")

    values = {(match.pii_type, match.text) for match in matches}
    assert (PiiType.NAME, "홍길동") in values
    assert all("서울특별시 강남구 테헤란로 1" != match.text for match in matches)


def test_detects_owner_name():
    matches = PiiDetector().detect("소유자: 김가상")

    assert any(match.pii_type is PiiType.NAME and match.text == "김가상" for match in matches)


def test_detects_name_in_separate_region_using_previous_label():
    matches = PiiDetector().detect_region("김가상", previous_text="임대인")

    assert matches == [PiiMatch(PiiType.NAME, "김가상", 0, 3)]


def test_detects_account_in_separate_region_using_previous_label():
    matches = PiiDetector().detect_region("123-456-789012", previous_text="입금 계좌")

    assert any(
        match.pii_type is PiiType.BANK_ACCOUNT
        and match.text == "123-456-789012"
        and match.start == 0
        for match in matches
    )
