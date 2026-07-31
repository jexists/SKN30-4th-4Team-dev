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
    # 첨부 실패로 질문까지 버리지 않기 위한 플래그. 프론트가 OCR·분석 단계에서 실패했을 때
    # 계약서 없이 그대로 물어보며 켠다 — 모델이 답을 지어내지 않고 "못 읽었다"고 먼저 밝히게
    # 하려는 것이다. 기본값이 False 라 이 필드를 모르는 예전 클라이언트도 그대로 동작한다.
    attachment_failed: bool = Field(
        default=False, description="이번 턴에 올린 첨부를 읽지 못했는지(OCR·분석 실패)"
    )


class ChatResponse(BaseModel):
    answer: str
    response_time_ms: int


# ── 대화 기록(chat_room / chat_message) ────────────────────────────────
DbRole = Literal["USER", "ASSISTANT", "SYSTEM"]

#: 한 메시지에 붙일 수 있는 첨부 개수. 분석 업로드 상한(analysis.py)과 같은 크기로 둔다.
MAX_MESSAGE_ATTACHMENTS = 10


class MessageAttachment(BaseModel):
    """메시지와 함께 보낸 첨부파일 한 개.

    **파일명과 종류만** 담는다 — 원본은 분석이 끝나면 지워지므로 서버가 다시 내려줄 수 없다.
    그래서 화면은 새로고침 뒤 썸네일 대신 아이콘 + 파일명으로 그린다(의도된 폴백).
    """

    name: str = Field(min_length=1, max_length=255)
    kind: Literal["image", "pdf", "file"] = "file"


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
    # 첨부한 파일 전체. 한 번에 여러 장을 올릴 수 있어 "계약서 3개 참고 중" 을 그리려면
    # 개수가 필요하다. analysis_file_name 은 기존 호출자를 위해 그대로 둔다.
    analysis_file_names: list[str] = Field(default_factory=list)
    # 목록 카드에 보여줄 마지막 메시지 한 줄. 메시지가 없으면 None.
    last_message_preview: str | None = None


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
    attachments: list[MessageAttachment] = Field(
        default_factory=list, max_length=MAX_MESSAGE_ATTACHMENTS
    )


class UpdateMessageIn(BaseModel):
    """이미 저장된 메시지의 본문(과 응답시간)을 교체한다.

    첨부를 읽지 못한 채 답한 뒤 '파일 다시 첨부' 로 재시도해 성공하면, 화면에서만 실패 답변을
    걷어내서는 부족하다 — 새로고침하면 DB 에 남은 실패 답변과 재시도 답변이 둘 다 보인다.
    그래서 새로 저장하지 않고 기존 행을 갈아끼운다. created_at 은 건드리지 않으므로 대화
    순서도 그대로다.

    content 상한은 AddMessageIn 과 같다 — 같은 컬럼에 들어가는 같은 성격의 본문이다.
    """

    content: str = Field(min_length=1, max_length=20000)
    response_time: int | None = None


class ChatMessageOut(BaseModel):
    id: str
    role: DbRole
    content: str
    created_at: datetime
    # 저장된 게 없으면 빈 배열. 프론트가 None 분기를 갖지 않도록 여기서 통일한다.
    attachments: list[MessageAttachment] = Field(default_factory=list)
