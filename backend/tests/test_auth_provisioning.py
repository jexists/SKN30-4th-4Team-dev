"""Supabase auth.users 프로비저닝 SQL의 가입 경계 회귀 테스트."""

from pathlib import Path


def test_kakao_identity_does_not_create_app_member_before_terms():
    sql = Path("sql/auth_provisioning.sql").read_text(encoding="utf-8").lower()

    provider_guard = "new.raw_app_meta_data->>'provider' = 'kakao'"
    assert provider_guard in sql
    assert sql.index(provider_guard) < sql.index("insert into public.app_user")
    assert (
        "return new;" in sql[sql.index(provider_guard) : sql.index("insert into public.app_user")]
    )


def test_email_provisioning_still_creates_required_agreements():
    sql = Path("sql/auth_provisioning.sql").read_text(encoding="utf-8").lower()

    assert "insert into public.app_user" in sql
    assert "(new.id, 'terms',     'v1', true" in sql
    assert "(new.id, 'privacy',   'v1', true" in sql
