"""Supabase JWT 검증(verify_token)과 보호 엔드포인트(/api/v1/me) 테스트."""

import time

import jwt
import pytest
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.core import config, security

TEST_SECRET = "test-jwt-secret-0123456789-abcdefghij"  # ≥32B (HMAC 권장 길이)


def _make_token(
    secret: str = TEST_SECRET,
    *,
    sub: str = "user-123",
    email: str = "user@example.com",
    role: str = "authenticated",
    aud: str = "authenticated",
    exp_delta: int = 3600,
    user_metadata: dict | None = None,
    omit: tuple[str, ...] = (),
) -> str:
    payload = {
        "sub": sub,
        "email": email,
        "role": role,
        "aud": aud,
        "exp": int(time.time()) + exp_delta,
    }
    if user_metadata is not None:
        payload["user_metadata"] = user_metadata
    for claim in omit:  # 필수 클레임 누락 케이스 검증용
        payload.pop(claim, None)
    return jwt.encode(payload, secret, algorithm="HS256")


@pytest.fixture()
def auth_secret(monkeypatch):
    """검증 시크릿을 테스트 값으로 설정(security.py 가 참조하는 공유 settings)."""
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_SECRET", TEST_SECRET)
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(config.settings, "JWT_LEEWAY_SECONDS", 60)
    return TEST_SECRET


# ── verify_token 단위 테스트 ────────────────────────────────────────────


def test_verify_token_none_when_secret_unset(monkeypatch):
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_SECRET", "")
    assert security.verify_token(_make_token()) is None


def test_verify_token_valid(auth_secret):
    claims = security.verify_token(_make_token(sub="abc", email="a@b.com"))
    assert claims is not None
    assert claims["sub"] == "abc"
    assert claims["email"] == "a@b.com"


def test_verify_token_wrong_secret(auth_secret):
    assert security.verify_token(_make_token(secret="a-different-secret")) is None


def test_verify_token_expired(auth_secret):
    assert security.verify_token(_make_token(exp_delta=-3600)) is None


def test_verify_token_wrong_audience(auth_secret):
    assert security.verify_token(_make_token(aud="some-other-aud")) is None


def test_verify_token_garbage(auth_secret):
    assert security.verify_token("not-a-jwt") is None


@pytest.mark.parametrize("claim", ["exp", "sub", "aud"])
def test_verify_token_requires_claim(auth_secret, claim):
    """만료·사용자 식별자·대상이 빠진 토큰은 서명이 맞아도 거부한다(fail-closed)."""
    assert security.verify_token(_make_token(omit=(claim,))) is None


# ── 실패 사유 구분 (401 재로그인 vs 503 서버 문제) ───────────────────────


def test_reason_ok(auth_secret):
    claims, reason = security.verify_token_with_reason(_make_token())
    assert reason == security.AUTH_OK
    assert claims is not None


def test_reason_expired(auth_secret):
    claims, reason = security.verify_token_with_reason(_make_token(exp_delta=-3600))
    assert claims is None
    assert reason == security.AUTH_EXPIRED


def test_reason_invalid_signature(auth_secret):
    _, reason = security.verify_token_with_reason(_make_token(secret="a-different-secret"))
    assert reason == security.AUTH_INVALID


def test_reason_garbage_is_invalid(auth_secret):
    _, reason = security.verify_token_with_reason("not-a-jwt")
    assert reason == security.AUTH_INVALID


def test_reason_unavailable_when_secret_unset(monkeypatch):
    """설정 누락은 사용자 잘못이 아니다 — 로그아웃이 아니라 서버 문제로 구분돼야 한다."""
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_SECRET", "")
    _, reason = security.verify_token_with_reason(_make_token())
    assert reason == security.AUTH_UNAVAILABLE


def test_within_leeway_still_valid(auth_secret):
    """시계 오차 허용 범위 안에서 갓 만료된 토큰은 통과한다(재부팅 직후 시계 밀림 대비)."""
    claims, reason = security.verify_token_with_reason(_make_token(exp_delta=-10))
    assert reason == security.AUTH_OK
    assert claims is not None


def test_beyond_leeway_is_expired(auth_secret):
    _, reason = security.verify_token_with_reason(_make_token(exp_delta=-120))
    assert reason == security.AUTH_EXPIRED


# ── 비대칭키(ES256, JWKS 경로) ─────────────────────────────────────────


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJwksClient:
    """PyJWKClient 대역 — 네트워크 없이 지정한 공개키를 돌려준다."""

    def __init__(self, public_key):
        self._public_key = public_key

    def get_signing_key_from_jwt(self, _token: str):
        return _FakeSigningKey(self._public_key)


def _es256_keypair():
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    return private_key, private_key.public_key()


def test_verify_token_asymmetric_es256(monkeypatch):
    private_key, public_key = _es256_keypair()
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(security, "_get_jwks_client", lambda: _FakeJwksClient(public_key))

    token = jwt.encode(
        {
            "sub": "u-es",
            "email": "es@example.com",
            "aud": "authenticated",
            "exp": int(time.time()) + 3600,
        },
        private_key,
        algorithm="ES256",
    )
    claims = security.verify_token(token)
    assert claims is not None
    assert claims["sub"] == "u-es"


def test_verify_token_asymmetric_wrong_key(monkeypatch):
    private_key, _ = _es256_keypair()
    _, other_public = _es256_keypair()  # 다른 키쌍의 공개키로 검증 → 실패해야 함
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(security, "_get_jwks_client", lambda: _FakeJwksClient(other_public))

    token = jwt.encode(
        {"sub": "u", "aud": "authenticated", "exp": int(time.time()) + 3600},
        private_key,
        algorithm="ES256",
    )
    claims, reason = security.verify_token_with_reason(token)
    assert claims is None
    assert reason == security.AUTH_INVALID


class _FailingJwksClient:
    """JWKS 조회가 실패하는 대역(네트워크 단절·Supabase 장애)."""

    def __init__(self, exc: Exception):
        self._exc = exc

    def get_signing_key_from_jwt(self, _token: str):
        raise self._exc


def _es256_token(private_key, *, exp_delta: int = 3600) -> str:
    return jwt.encode(
        {"sub": "u", "aud": "authenticated", "exp": int(time.time()) + exp_delta},
        private_key,
        algorithm="ES256",
    )


@pytest.mark.parametrize(
    "exc",
    [
        PyJWKClientConnectionError("JWKS 응답 없음"),
        OSError("네트워크 없음"),
        ValueError("JWKS 파싱 실패"),
    ],
)
def test_jwks_fetch_failure_is_unavailable(monkeypatch, exc):
    """JWKS 를 못 받아온 건 서버 문제다 — 멀쩡한 세션을 만료로 취급하면 안 된다."""
    private_key, _ = _es256_keypair()
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(security, "_get_jwks_client", lambda: _FailingJwksClient(exc))

    _, reason = security.verify_token_with_reason(_es256_token(private_key))
    assert reason == security.AUTH_UNAVAILABLE


def test_jwks_key_not_found_is_invalid(monkeypatch):
    """kid 를 못 찾은 건 다른 프로젝트의 토큰일 수 있으므로 사용자 문제(401)로 본다."""
    private_key, _ = _es256_keypair()
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(
        security,
        "_get_jwks_client",
        lambda: _FailingJwksClient(PyJWKClientError("kid 없음")),
    )

    _, reason = security.verify_token_with_reason(_es256_token(private_key))
    assert reason == security.AUTH_INVALID


def test_asymmetric_without_supabase_url_is_unavailable(monkeypatch):
    private_key, _ = _es256_keypair()
    monkeypatch.setattr(config.settings, "SUPABASE_URL", "")
    monkeypatch.setattr(security, "_jwks_client", None)

    _, reason = security.verify_token_with_reason(_es256_token(private_key))
    assert reason == security.AUTH_UNAVAILABLE


# ── /api/v1/me 엔드포인트 테스트 ────────────────────────────────────────


def test_me_requires_auth(client):
    resp = client.get("/api/v1/me")
    assert resp.status_code == 401
    body = resp.json()
    assert body["success"] is False
    assert body["error"]["title"] == "UNAUTHORIZED"


def test_me_rejects_bad_token(client, auth_secret):
    resp = client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


def test_me_returns_user_with_valid_token(client, auth_secret):
    token = _make_token(
        sub="user-999",
        email="me@example.com",
        user_metadata={"nickname": "홈실드"},
    )
    resp = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["id"] == "user-999"
    assert data["email"] == "me@example.com"
    assert data["role"] == "authenticated"
    assert data["nickname"] == "홈실드"


def test_me_uses_email_name_when_signup_nickname_is_empty(client, auth_secret):
    token = _make_token(email="fallback@example.com", user_metadata={"nickname": "  "})
    resp = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.json()["data"]["nickname"] == "fallback"


def test_me_expired_token_says_expired(client, auth_secret):
    """만료는 별도 코드로 알린다 — 프론트가 '갱신 후 재시도'를 판단할 수 있어야 한다."""
    token = _make_token(exp_delta=-3600)
    resp = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
    assert resp.json()["error"]["title"] == "TOKEN_EXPIRED"


def test_me_malformed_header_is_unauthorized(client, auth_secret):
    resp = client.get("/api/v1/me", headers={"Authorization": "Basic abc"})
    assert resp.status_code == 401
    assert resp.json()["error"]["title"] == "UNAUTHORIZED"


def test_me_returns_503_when_auth_backend_unreachable(client, monkeypatch):
    """JWKS 장애로는 로그아웃시키지 않는다 — 401 이 아니라 503 이어야 한다."""
    private_key, _ = _es256_keypair()
    monkeypatch.setattr(config.settings, "SUPABASE_JWT_AUD", "authenticated")
    monkeypatch.setattr(
        security,
        "_get_jwks_client",
        lambda: _FailingJwksClient(PyJWKClientConnectionError("JWKS 응답 없음")),
    )

    token = _es256_token(private_key)
    resp = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 503
    assert resp.json()["error"]["title"] == "AUTH_UNAVAILABLE"


def test_chat_rooms_expired_token_says_expired(client, auth_secret):
    """사용자가 실제로 겪은 경로(POST /chat/rooms)도 만료를 구분해 알린다."""
    token = _make_token(exp_delta=-3600)
    resp = client.post(
        "/api/v1/chat/rooms",
        json={"title": "테스트"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["title"] == "TOKEN_EXPIRED"
