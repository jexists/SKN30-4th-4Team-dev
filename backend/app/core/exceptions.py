import logging

import psycopg
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout
from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import TimeoutError as SATimeoutError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.common import error_response

logger = logging.getLogger(__name__)

# 커넥션 고갈·연결 끊김은 "잠시 후 되는" 일시적 장애다. 500(버그) 이 아니라 503 으로 알려
# 클라이언트가 재시도할 수 있게 한다.
_DB_BUSY_TITLE = "일시적인 접속 지연"
_DB_BUSY_MESSAGE = "접속이 몰려 잠시 지연되고 있습니다. 잠시 후 다시 시도해 주세요."

_TRANSIENT_SQLSTATE_CLASSES = {"08", "53", "58"}
_TRANSIENT_SQLSTATES = {"57P01", "57P02", "57P03", "57P04"}


class AppError(Exception):
    """도메인 예외. 이것만 던지면 핸들러가 표준 error 봉투로 변환한다.

    title·message 는 그대로 **사용자에게 보이는 오류 모달**이 된다(title=제목, message=본문).
    내부 예외 문자열이나 코드형 식별자를 넣지 말고, 읽을 수 있는 한국어 문구를 쓴다.
    분기용 식별자가 필요하면 code(HTTP 상태)를 쓴다.

    toast 를 주면 모달과 별개로 토스트도 함께 뜬다. 보통은 필요 없다.
    """

    def __init__(self, title: str, message: str, code: int = 400, toast: str = ""):
        self.title = title
        self.message = message
        self.code = code
        self.toast = toast
        super().__init__(message)


def _json(code: int, title: str, message: str, toast: str = "") -> JSONResponse:
    return JSONResponse(
        status_code=code, content=error_response(title, message, code, toast).model_dump()
    )


def _is_connection_error(exc: DBAPIError) -> bool:
    """일시적 인프라 장애(재시도 가치 있음)인지 판정.

    - connection_invalidated: 쓰던 커넥션이 끊겨 SQLAlchemy 가 풀에서 무효화한 경우.
    - psycopg.OperationalError: SQLSTATE class 08/53/58 및 서버 종료·연결 불가
      57P01~57P04 계열. EMAXCONNSESSION처럼 표준 코드가 불안정한 실제 장애도 식별한다.

    OperationalError 전체를 허용하면 잘못된 비밀번호(28P01), 트랜잭션 롤백(40),
    프로그램 한도(54) 같은 영구 오류까지 503으로 숨겨진다. SQLSTATE가 없는
    OperationalError는 DNS·TCP 연결 실패처럼 서버 응답 전 실패한 경우라
    재시도 대상으로 본다.
    """
    if getattr(exc, "connection_invalidated", False):
        return True
    orig = exc.orig
    if not isinstance(orig, psycopg.OperationalError):
        return False

    sqlstate = getattr(orig, "sqlstate", None)
    if sqlstate is None:
        return True
    if sqlstate[:2] in _TRANSIENT_SQLSTATE_CLASSES or sqlstate in _TRANSIENT_SQLSTATES:
        return True

    message = str(orig).upper()
    return "EMAXCONNSESSION" in message or "MAX CLIENTS REACHED" in message


def register_exception_handlers(app: FastAPI) -> None:
    """예외 → 표준 응답 봉투(error) 자동 변환 핸들러 등록."""

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return _json(exc.code, exc.title, exc.message, exc.toast)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _json(exc.status_code, "요청 오류", str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _json(422, "입력값 오류", "요청 값이 올바르지 않습니다.")

    # ── DB 커넥션 계열 → 503 ────────────────────────────────────────
    # Starlette 은 예외 클래스의 MRO 를 타고 핸들러를 찾으므로 아래 catch-all 보다 우선한다.
    # 라우트 본문뿐 아니라 의존성(require_member 등)에서 터진 예외도 같은 경로로 잡힌다.
    #
    # 로그에 넣는 request.url.path 는 별도 sanitize 가 필요 없다 — Starlette 이 URL 을
    # 재구성하며 urlsplit 을 거치는데, CPython 3.10+ urlsplit 이 CR/LF 를 제거하기 때문이다
    # (`/x/%0A...` → 개행 없이 기록). 단, raw scope["path"] 나 request.url 전체를 그대로
    # 찍으면 개행이 살아 있어 로그 위조가 가능하다. test_log_path_has_no_newline 이 고정한다.

    @app.exception_handler(SATimeoutError)
    async def _pool_timeout(request: Request, exc: SATimeoutError) -> JSONResponse:
        """QueuePool 체크아웃 타임아웃 — OperationalError 의 서브클래스가 아니라 별도 등록."""
        logger.warning(
            "DB 커넥션 풀 대기 초과: %s %s",
            request.method,
            request.url.path,
            exc_info=True,
        )
        return _json(503, _DB_BUSY_TITLE, _DB_BUSY_MESSAGE)

    @app.exception_handler(PoolTimeout)
    async def _psycopg_pool_timeout(request: Request, exc: PoolTimeout) -> JSONResponse:
        """psycopg 풀(RAG 검색) 대기 초과. search.py 가 삼키므로 보통은 도달하지 않는다."""
        logger.warning(
            "psycopg 풀 대기 초과: %s %s",
            request.method,
            request.url.path,
            exc_info=True,
        )
        return _json(503, _DB_BUSY_TITLE, _DB_BUSY_MESSAGE)

    @app.exception_handler(DBAPIError)
    async def _dbapi_error(request: Request, exc: DBAPIError) -> JSONResponse:
        """연결 계열만 503. 문법 오류·없는 테이블·무결성 위반까지 숨기면 버그를 못 본다."""
        if not _is_connection_error(exc):
            logger.exception("DB 오류: %s %s", request.method, request.url.path)
            return _json(500, "서버 오류", "잠시 후 다시 시도해 주세요.")
        logger.warning(
            "DB 연결 실패: %s %s — %s",
            request.method,
            request.url.path,
            exc.orig,
            exc_info=True,
        )
        return _json(503, _DB_BUSY_TITLE, _DB_BUSY_MESSAGE)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # 내부 예외 내용은 로그로만 남긴다 — message 는 사용자에게 그대로 보인다.
        logger.exception("처리되지 않은 예외: %s %s", request.method, request.url.path)
        return _json(500, "서버 오류", "잠시 후 다시 시도해 주세요.")
