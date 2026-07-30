from app.masking.detector import PiiDetector
from app.masking.sanitizer import sanitize_text


def test_replaces_pii_without_returning_original_values():
    original = (
        "임차인: 홍길동 주소: 서울특별시 강남구 테헤란로 1 "
        "연락처: 010-1234-5678 이메일: test@example.com"
    )

    result = sanitize_text(original, PiiDetector().detect(original))

    assert "홍길동" not in result.text
    assert "서울특별시 강남구 테헤란로 1" in result.text
    assert "010-1234-5678" not in result.text
    assert "test@example.com" not in result.text
    assert "[이름]" in result.text
    assert "[주소]" not in result.text
    assert "[전화번호]" in result.text
    assert "[이메일]" in result.text
    assert PiiDetector().detect(result.text) == []
