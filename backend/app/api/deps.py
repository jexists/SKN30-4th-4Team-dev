from typing import Annotated

from fastapi import Depends, Header

from app.core.exceptions import AppError
from app.core.security import AUTH_EXPIRED, AUTH_UNAVAILABLE, verify_token_with_reason

# Authorization 헤더가 아예 없거나 Bearer 형식이 아닐 때의 사유.
AUTH_MISSING = "missing"


def _authenticate(
    authorization: Annotated[str | None, Header()] = None,
) -> tuple[dict | None, str]:
    """Authorization 헤더를 검증해 (클레임, 사유) 를 반환한다.

    사유를 함께 들고 다니는 이유: '토큰 없음'·'만료'·'서명 오류'·'인증 서버 장애' 를
    같은 401 로 뭉개면 프론트가 "재로그인시킬 것 vs 잠시 후 재시도할 것" 을 구분할 수 없다.

    sync 함수인 이유: verify_token_with_reason 내부의 PyJWKClient 조회(캐시 미스·kid
    회전 시)가 동기 HTTP 라 async 로 두면 이벤트 루프를 블록한다. sync 로 두면
    FastAPI 가 threadpool 에서 실행해 다른 요청을 막지 않는다.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        return None, AUTH_MISSING
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None, AUTH_MISSING
    return verify_token_with_reason(token)


def get_current_user(
    auth: Annotated[tuple[dict | None, str], Depends(_authenticate)],
) -> dict | None:
    """현재 사용자(클레임). 미인증이면 None — 인증이 '선택'인 엔드포인트에서 쓴다.

    인증이 '필수'인 곳은 아래 require_user 를 쓴다.
    """
    return auth[0]


def require_user(
    auth: Annotated[tuple[dict | None, str], Depends(_authenticate)],
) -> dict:
    """인증이 필수인 엔드포인트용. 실패 사유에 따라 401/503(표준 error 봉투)을 던진다.

    - 503 인증 서버 오류: 우리 쪽 설정 누락이나 Supabase JWKS 장애다. 사용자 세션은
      멀쩡하므로 프론트가 로그아웃시키면 안 된다.
    - 401 (토큰 만료): 프론트가 갱신을 시도하고, 실패하면 재로그인.
    - 401 (토큰 없음·무효)

    401 두 경우는 프론트가 code 로만 구분하면 되므로 모달 제목은 "로그인 필요"로 같다.
    """
    user, reason = auth
    if user is not None:
        return user

    if reason == AUTH_UNAVAILABLE:
        raise AppError(
            "인증 서버 오류",
            "인증 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
            503,
        )
    if reason == AUTH_EXPIRED:
        raise AppError("로그인 필요", "세션이 만료되었습니다. 다시 로그인해 주세요.", 401)
    raise AppError("로그인 필요", "로그인이 필요합니다.", 401)


# 라우트 시그니처에서 바로 쓰는 별칭.
CurrentUser = Annotated[dict | None, Depends(get_current_user)]  # 선택 인증
RequireUser = Annotated[dict, Depends(require_user)]  # 필수 인증
