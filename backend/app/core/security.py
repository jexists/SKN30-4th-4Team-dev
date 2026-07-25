"""Supabase JWT 검증 헬퍼.

인증은 Supabase Auth 가 담당한다(로그인·토큰 발급). 백엔드는 프론트가 Authorization
헤더로 보낸 액세스 토큰(JWT)을 '검증만' 한다 — 로그인/회원가입 엔드포인트는 만들지 않는다.

Supabase 는 프로젝트마다 두 가지 방식 중 하나로 토큰에 서명한다. 여기서는 토큰 헤더의
alg 를 보고 둘 다 자동으로 검증한다.
- HS256(대칭키): 공유 JWT Secret(SUPABASE_JWT_SECRET)으로 검증.
  (대시보드 → Settings → API → JWT Settings → JWT Secret)
- ES256/RS256(비대칭키): Supabase JWKS 공개키로 검증(비밀 공유 불필요).
  공개키는 {SUPABASE_URL}/auth/v1/.well-known/jwks.json 에서 받아 캐시한다.

실패는 '사용자 문제'와 '서버 문제'를 구분해서 돌려준다(AUTH_* 상수). 예전에는 헤더 없음·
만료·서명 오류·JWKS 장애·설정 누락이 전부 같은 401 로 뭉개져서, 로그만으로는 원인을
특정할 수 없었고 Supabase 일시 장애가 "로그인하세요" 로 둔갑했다.
"""

import logging

import jwt
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError

from app.core.config import settings

logger = logging.getLogger(__name__)

# JWKS 공개키 클라이언트(URL당 1개 캐시). PyJWKClient 는 내부적으로 키를 캐시한다.
_jwks_client: PyJWKClient | None = None
_jwks_url: str | None = None

# Supabase 액세스 토큰에는 항상 있는 클레임. 하나라도 없으면 사용자 토큰이 아니므로 거부한다.
#   exp 없음 → 만료되지 않는 토큰,  sub 없음 → 사용자 식별 불가.
#   aud 는 audience= 만으로도 PyJWT 가 부재 시 거부하지만, 의도를 드러내려 함께 적는다.
_REQUIRED_CLAIMS = {"require": ["exp", "sub", "aud"]}

# 검증 결과 사유. deps 가 이 값을 보고 401(재로그인) 과 503(서버 문제) 을 가른다.
AUTH_OK = "ok"
AUTH_INVALID = "invalid"  # 서명·audience·필수 클레임 오류 → 401
AUTH_EXPIRED = "expired"  # exp 지남 → 401(재로그인 유도)
AUTH_UNAVAILABLE = "unavailable"  # 검증 설정 누락·JWKS 조회 실패 → 503(서버 문제)


def _get_jwks_client() -> PyJWKClient | None:
    """Supabase JWKS 공개키 클라이언트. SUPABASE_URL 이 있어야 만든다(없으면 None)."""
    global _jwks_client, _jwks_url
    base = settings.SUPABASE_URL.rstrip("/")
    if not base:
        return None
    url = f"{base}/auth/v1/.well-known/jwks.json"
    if _jwks_client is None or _jwks_url != url:
        _jwks_client = PyJWKClient(url)
        _jwks_url = url
    return _jwks_client


def _fail(reason: str, detail: str) -> tuple[None, str]:
    """검증 실패를 사유와 함께 로그로 남긴다.

    토큰 값·클레임은 절대 로그에 남기지 않는다(예외 타입명과 사유만).
    설정·네트워크 문제(AUTH_UNAVAILABLE)는 운영자가 조치해야 하므로 ERROR 로 올린다.
    """
    log = logger.error if reason == AUTH_UNAVAILABLE else logger.warning
    log("JWT 검증 실패 (%s): %s", reason, detail)
    return None, reason


def verify_token_with_reason(token: str) -> tuple[dict | None, str]:
    """토큰을 검증해 (클레임, 사유) 를 반환. 성공이면 (claims, AUTH_OK).

    실패 사유는 AUTH_EXPIRED / AUTH_INVALID / AUTH_UNAVAILABLE 중 하나다.
    exp·nbf 검사에는 settings.JWT_LEEWAY_SECONDS 만큼 시계 오차를 허용한다 — 재부팅 직후
    처럼 클라이언트 시계가 조금 어긋난 사용자를 멀쩡한 토큰으로 내쫓지 않기 위해서다.
    """
    try:
        alg = jwt.get_unverified_header(token).get("alg", "")
    except jwt.PyJWTError as exc:
        return _fail(AUTH_INVALID, f"헤더를 읽을 수 없음({type(exc).__name__})")

    aud = settings.SUPABASE_JWT_AUD
    leeway = settings.JWT_LEEWAY_SECONDS

    # 대칭키(HS256) — 공유 JWT Secret 으로 검증.
    if alg.startswith("HS"):
        secret = settings.SUPABASE_JWT_SECRET
        if not secret:
            return _fail(AUTH_UNAVAILABLE, "HS256 토큰인데 SUPABASE_JWT_SECRET 이 비어 있음")
        try:
            claims = jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience=aud,
                leeway=leeway,
                options=_REQUIRED_CLAIMS,
            )
        except jwt.ExpiredSignatureError:
            return _fail(AUTH_EXPIRED, "액세스 토큰 만료(HS256)")
        except jwt.PyJWTError as exc:
            return _fail(AUTH_INVALID, f"HS256 검증 실패({type(exc).__name__})")
        return claims, AUTH_OK

    # 비대칭키(ES256/RS256) — Supabase JWKS 공개키로 검증.
    if alg.startswith(("ES", "RS")):
        client = _get_jwks_client()
        if client is None:
            return _fail(AUTH_UNAVAILABLE, "비대칭 토큰인데 SUPABASE_URL 이 비어 있음")

        # 키 조회 실패와 서명 검증 실패를 분리한다. 전자는 서버·네트워크 문제라
        # 사용자를 로그아웃시키면 안 된다(503).
        try:
            signing_key = client.get_signing_key_from_jwt(token)
        except PyJWKClientConnectionError as exc:
            return _fail(AUTH_UNAVAILABLE, f"JWKS 조회 실패({type(exc).__name__})")
        except PyJWKClientError as exc:
            # kid 불일치 등 — 다른 프로젝트에서 발급된 토큰일 수 있다.
            return _fail(AUTH_INVALID, f"서명 키를 찾지 못함({type(exc).__name__})")
        except OSError as exc:  # URLError·timeout 등 네트워크 계열
            return _fail(AUTH_UNAVAILABLE, f"JWKS 네트워크 오류({type(exc).__name__})")
        except Exception as exc:  # JSON 파싱 실패 등 예상 밖 → 서버 문제로 취급
            # 여기만 traceback 까지 남긴다. 위의 분기들은 원인이 이미 특정된 운영 이슈지만,
            # 이 분기는 '무엇인지 모르는 것'이라 스택 없이는 Supabase 장애인지 우리 코드
            # 결함인지 가릴 수 없다. 토큰은 인자로만 넘어가므로 traceback 에 값이 찍히지 않는다.
            logger.exception("JWKS 처리 중 예상 밖 예외 (jwks_url=%s)", _jwks_url)
            return _fail(AUTH_UNAVAILABLE, f"JWKS 처리 오류({type(exc).__name__})")

        try:
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256", "RS256"],
                audience=aud,
                leeway=leeway,
                options=_REQUIRED_CLAIMS,
            )
        except jwt.ExpiredSignatureError:
            return _fail(AUTH_EXPIRED, "액세스 토큰 만료(비대칭)")
        except jwt.PyJWTError as exc:
            return _fail(AUTH_INVALID, f"비대칭 검증 실패({type(exc).__name__})")
        return claims, AUTH_OK

    return _fail(AUTH_INVALID, f"지원하지 않는 alg({alg or '없음'})")


def verify_token(token: str) -> dict | None:
    """Supabase 액세스 토큰(JWT)을 검증해 클레임(dict)을 반환. 실패하면 None.

    사유가 필요 없는 호출부(선택 인증 등)를 위한 얇은 래퍼다. 401/503 을 구분해야 하는
    곳은 verify_token_with_reason 을 쓴다.
    """
    return verify_token_with_reason(token)[0]


def describe_verification_mode() -> str:
    """기동 로그용 — 지금 어떤 방식으로 JWT 를 검증할 수 있는 상태인지(값은 노출하지 않는다)."""
    modes = []
    if settings.SUPABASE_JWT_SECRET:
        modes.append("HS256 대칭키(SUPABASE_JWT_SECRET)")
    if settings.SUPABASE_URL:
        modes.append("JWKS 비대칭키(SUPABASE_URL)")
    if not modes:
        return (
            "검증 설정 없음 — 보호 엔드포인트가 모두 실패한다"
            " (SUPABASE_JWT_SECRET 또는 SUPABASE_URL 필요)"
        )
    return " · ".join(modes)
