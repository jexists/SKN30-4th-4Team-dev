from pydantic import BaseModel


class ErrorDetail(BaseModel):
    title: str
    message: str


class ApiResponse[T](BaseModel):
    """모든 엔드포인트가 사용하는 표준 응답 봉투.

    성공: success=True, data 채움, error=None
    실패: success=False, data=None, error 채움 (에러 핸들러가 자동 생성)
    """

    success: bool
    code: int = 200
    message: str = "OK"
    data: T | None = None
    error: ErrorDetail | None = None


def success_response(data: object = None, message: str = "OK", code: int = 200) -> ApiResponse:
    return ApiResponse(success=True, code=code, message=message, data=data, error=None)


def error_response(title: str, message: str, code: int = 400) -> ApiResponse:
    return ApiResponse(
        success=False,
        code=code,
        message=message,
        data=None,
        error=ErrorDetail(title=title, message=message),
    )
