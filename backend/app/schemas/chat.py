from datetime import datetime
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


# ── 대화 기록(chat_room / chat_message) ────────────────────────────────
DbRole = Literal["USER", "ASSISTANT", "SYSTEM"]


class CreateRoomIn(BaseModel):
    """새 채팅방 생성 요청 (title = 첫 질문 요약)."""

    title: str = Field(min_length=1, max_length=200)


class ChatRoomOut(BaseModel):
    """채팅방 목록 항목. id 는 문자열로 내보낸다(프론트 문자열 id)."""

    id: str
    title: str | None
    updated_at: datetime


class AddMessageIn(BaseModel):
    """메시지 저장 요청."""

    role: DbRole
    content: str = Field(min_length=1)
    response_time: int | None = None


class ChatMessageOut(BaseModel):
    id: str
    role: DbRole
    content: str
    created_at: datetime
