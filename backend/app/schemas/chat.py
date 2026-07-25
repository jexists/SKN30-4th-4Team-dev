from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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


class UpdateRoomTitleIn(BaseModel):
    """채팅방 제목 수정 요청. 앞뒤 공백은 제거하고, 공백만 있으면 min_length 에서 422."""

    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=200)


class ChatRoomOut(BaseModel):
    """채팅방 목록 항목. id 는 문자열로 내보낸다(프론트 문자열 id)."""

    id: str
    title: str | None
    last_chat_at: datetime
    updated_at: datetime


class AddMessageIn(BaseModel):
    """메시지 저장 요청.

    content 상한(20000)은 질문(ChatRequest.message = 2000)보다 훨씬 넉넉하다 — 저장 대상에
    근거 조문·판례를 붙인 RAG 답변이 들어오기 때문이다. 상한 자체는 두어야 무제한 본문이
    DB(text 컬럼)로 그대로 들어가는 것을 막는다.
    """

    role: DbRole
    content: str = Field(min_length=1, max_length=20000)
    response_time: int | None = None


class ChatMessageOut(BaseModel):
    id: str
    role: DbRole
    content: str
    created_at: datetime
