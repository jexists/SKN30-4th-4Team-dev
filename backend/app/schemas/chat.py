from typing import Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    """대화 맥락 한 줄 (프론트가 DB 기록에서 최근 N개를 보냄)."""

    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """RAG 챗봇 요청. history 로 이전 대화 맥락을 함께 전달한다(멀티턴)."""

    message: str = Field(min_length=1, max_length=2000, description="사용자 발화")
    history: list[ChatTurn] = Field(default_factory=list, description="최근 대화 맥락")


class ChatResponse(BaseModel):
    answer: str
    response_time_ms: int
