import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.common import error_response

logger = logging.getLogger(__name__)


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

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # 내부 예외 내용은 로그로만 남긴다 — message 는 사용자에게 그대로 보인다.
        logger.exception("처리되지 않은 예외: %s %s", request.method, request.url.path)
        return _json(500, "서버 오류", "잠시 후 다시 시도해 주세요.")
