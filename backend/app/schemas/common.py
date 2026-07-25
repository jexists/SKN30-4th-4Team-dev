from pydantic import BaseModel


class ErrorDetail(BaseModel):
    title: str
    message: str


class ApiResponse[T](BaseModel):
    """모든 엔드포인트가 사용하는 표준 응답 봉투.

    성공: success=True, data 채움, error=None
    실패: success=False, data=None, error 채움 (에러 핸들러가 자동 생성)

    **message 와 error 는 프론트에서 서로 다른 UI 로 간다** — 아래 두 헬퍼 참고.
    """

    success: bool
    code: int = 200
    message: str = ""  # 토스트 전용. 비우면 토스트를 띄우지 않는다.
    data: T | None = None
    error: ErrorDetail | None = None


class Page[T](BaseModel):
    """커서 기반 페이지네이션 응답. next_cursor 가 None 이면 더 없음."""

    items: list[T]
    next_cursor: str | None = None


def success_response(data: object = None, message: str = "", code: int = 200) -> ApiResponse:
    """성공 응답.

    message 는 **토스트 전용**이다. "저장되었습니다" 처럼 사용자에게 알릴 게 있을 때만
    채우고, 그럴 필요가 없으면 비워 둔다(기본값). 여기에 "OK" 같은 값을 넣으면
    프론트가 성공할 때마다 의미 없는 토스트를 띄운다.
    """
    return ApiResponse(success=True, code=code, message=message, data=data, error=None)


def error_response(title: str, message: str, code: int = 400, toast: str = "") -> ApiResponse:
    """실패 응답.

    title·message 는 **오류 모달**로 가고(message 가 비면 제목만 표시), toast 는 봉투
    message(**토스트**)로 따로 나간다. 둘을 같은 문자열로 채우면 같은 문장이 모달과
    토스트에 두 번 뜬다 — 그래서 toast 의 기본값은 빈 문자열이다.
    """
    return ApiResponse(
        success=False,
        code=code,
        message=toast,
        data=None,
        error=ErrorDetail(title=title, message=message),
    )
