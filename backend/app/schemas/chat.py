from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """멀티턴 채팅 요청. thread_id 를 유지해 재호출하면 대화 맥락이 이어진다."""

    message: str = Field(min_length=1, max_length=2000, description="사용자 발화")
    thread_id: str | None = Field(default=None, description="대화 세션 id (없으면 새로 발급)")


class ChatResponse(BaseModel):
    answer: str
    thread_id: str
