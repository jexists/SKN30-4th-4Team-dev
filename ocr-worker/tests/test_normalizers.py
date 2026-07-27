from app.extraction.normalizers import (
    normalize_area,
    normalize_date,
    normalize_money,
    normalize_name,
    normalize_rate,
    normalize_registration_no,
    normalize_unit_no,
)


def test_normalizes_contract_field_values():
    assert normalize_money("금 이억오천만원정") == 250_000_000
    assert normalize_money("₩250,000,000") == 250_000_000
    assert normalize_date("2026. 7. 20.") == "2026-07-20"
    assert normalize_unit_no("제202호") == "202"
    assert normalize_unit_no("b02") == "B02"
    assert normalize_name("김 임 대") == "김임대"
    assert normalize_registration_no("11500 - 2021 - 00123") == "11500-2021-00123"
    assert normalize_area("13.4평") == 44.3
    assert normalize_rate("0.4%") == 0.004
