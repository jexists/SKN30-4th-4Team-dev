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
    # 계약서 본문은 요청으로 왕복하지 않는다 — 방 id 만 받고 서버가 DB 에서 읽는다.
    # (첨부 텍스트는 수만 자라 매 턴 실어 보내면 요청이 비대해지고 상한도 넘긴다.)
    room_id: str | None = Field(
        default=None, description="첨부 계약서를 찾을 대화방 id (없으면 일반 질문)"
    )


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
    """채팅방 목록 항목. id 는 문자열로 내보낸다(프론트 문자열 id).

    analysis_* 두 필드는 첨부된 계약서를 화면에 복원하기 위한 것이다. 새로고침하거나 대화를
    다시 열어도 첨부 칩이 그대로 보여야 하므로 방 정보에 함께 싣는다.
    """

    id: str
    title: str | None
    last_chat_at: datetime
    updated_at: datetime
    analysis_job_id: str | None = None
    # 칩에 표시할 파일명(analysis_job.file_names 의 첫 항목). 첨부가 없으면 None.
    analysis_file_name: str | None = None


class AttachDocumentIn(BaseModel):
    """완료된 계약서 분석을 대화방에 첨부한다."""

    analysis_job_id: str


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
