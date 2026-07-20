from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.common import error_response


class AppError(Exception):
    """도메인 예외. 이것만 던지면 핸들러가 표준 error 봉투로 변환한다."""

    def __init__(self, title: str, message: str, code: int = 400):
        self.title = title
        self.message = message
        self.code = code
        super().__init__(message)


def _json(code: int, title: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=code, content=error_response(title, message, code).model_dump())


def register_exception_handlers(app: FastAPI) -> None:
    """예외 → 표준 응답 봉투(error) 자동 변환 핸들러 등록."""

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return _json(exc.code, exc.title, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return _json(exc.status_code, "HTTP_ERROR", str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        return _json(422, "VALIDATION_ERROR", "요청 값이 올바르지 않습니다.")

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        return _json(500, "INTERNAL_ERROR", "서버 내부 오류가 발생했습니다.")
