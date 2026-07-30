"""AI 챗봇 엔드포인트 — LangGraph RAG 답변(app.agent.graph_rag) + 대화 기록 CRUD.

멀티턴 맥락은 요청의 history 로 주입한다(프론트가 최근 N개를 함께 보낸다). 대화 기록(방·메시지)의
저장·조회는 이 라우터가 담당한다 — 백엔드가 Supabase Postgres 에 연결하고, 연결 role 이 RLS 를
우회하므로 소유권(user_id==sub)은 코드가 직접 검증한다.
"""

import logging
import time
import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.cursor import decode_cursor, encode_cursor
from app.api.deps import CurrentUser, RequireMember
from app.core.exceptions import AppError
from app.db.session import get_app_db
from app.models.analysis_job import AnalysisJob, JobStatus
from app.models.chat import ChatMessage, ChatRoom, monotonic_utcnow
from app.repositories.analysis_job import AnalysisJobRepository
from app.schemas.chat import (
    AddMessageIn,
    AttachDocumentIn,
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    ChatRoomOut,
    CreateRoomIn,
    UpdateRoomTitleIn,
)
from app.schemas.common import ApiResponse, Page, success_response

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

AppDb = Annotated[Session, Depends(get_app_db)]

# 페이지네이션 파라미터: 기본 30개, 1~100 클램프.
Limit = Annotated[int, Query(ge=1, le=100)]

# 없는 방·남의 방·잘못된 UUID 를 한 문구로 묶는다(존재 여부를 알려주지 않는다).
_ROOM_NOT_FOUND = "이미 삭제되었거나 존재하지 않는 대화입니다."

# graph_rag 는 langgraph·langchain-openai 를 요구하므로 지연 로드한다.
# (미설치·초기화 실패해도 서버 기동과 다른 엔드포인트는 영향받지 않는다.)
_run_turn = None


def _get_run_turn():
    global _run_turn
    if _run_turn is None:
        try:
            from app.agent.graph_rag import run_turn
        except Exception as e:  # 의존성 미설치 / 초기화 실패
            # 원인(미설치 패키지 등)은 로그로만 남긴다 — message 는 사용자에게 그대로 보인다.
            logger.exception("챗봇 엔진 로드 실패")
            raise AppError(
                "챗봇 사용 불가",
                "챗봇 엔진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
                503,
            ) from e
        _run_turn = run_turn
    return _run_turn


def prewarm_engine() -> bool:
    """기동 시 챗봇 엔진(langchain·langgraph import + 그래프 컴파일)을 미리 로드한다.

    첫 요청이 이 비용을 물지 않게 하려는 것뿐이므로 실패는 삼킨다 — 실제 요청에서
    _get_run_turn 이 다시 시도하고, 그때도 실패하면 503 을 돌려준다. OPENAI_API_KEY 가
    없으면 graph_rag 의 ChatOpenAI 생성이 여기서 터지지만 기동은 그대로 계속된다.
    """
    try:
        _get_run_turn()
    except Exception:
        return False  # 원인은 _get_run_turn 이 이미 logger.exception 으로 남겼다
    return True


def _room_document_text(db: Session, room_id: str | None, user: dict | None) -> str | None:
    """방에 첨부된 계약서 본문(개인정보 치환 완료)을 읽는다. 없으면 None.

    첨부는 로그인 사용자의 방에만 붙으므로 비로그인 요청은 곧바로 None 이다.
    첨부가 풀렸거나 분석이 지워진 경우도 조용히 None 로 흘린다 — 계약서를 못 찾았다고 대화를
    끊는 것보다 일반 답변이라도 나가는 편이 낫다.
    """
    if not room_id or user is None:
        return None
    try:
        uid = uuid.UUID(str(user.get("sub", "")))
        rid = uuid.UUID(room_id)
    except ValueError:
        return None

    room = db.execute(
        select(ChatRoom).where(
            ChatRoom.id == rid,
            ChatRoom.user_id == uid,
            ChatRoom.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if room is None or room.analysis_job_id is None:
        return None

    result = AnalysisJobRepository(db).get_result(room.analysis_job_id)
    if result is None:
        return None
    text = (result.payload or {}).get("sanitized_text")
    if not isinstance(text, str):
        return None
    return text.strip() or None


@router.post("/chat", response_model=ApiResponse[ChatResponse])
def chat(req: ChatRequest, user: CurrentUser, db: AppDb) -> ApiResponse[ChatResponse]:
    """한 턴을 처리하고 답변 + 응답시간(ms)을 돌려준다.

    동기 함수라 FastAPI 가 스레드풀에서 실행 → OpenAI 블로킹 호출이 이벤트 루프를 막지 않는다.

    인증은 **선택**이다(CurrentUser). 비로그인·Supabase 미설정 상태의 비영속 대화가 그대로
    동작해야 하므로 필수 인증으로 바꾸지 않는다. room_id 와 로그인이 모두 있을 때만 그 방에
    첨부된 계약서를 함께 넣는다.
    """
    run_turn = _get_run_turn()
    history = [t.model_dump() for t in req.history]

    document_context = _room_document_text(db, req.room_id, user)
    # LLM 호출은 수십 초가 걸린다. 그동안 커넥션을 쥐고 있으면 동시 대화 몇 건만으로 풀이
    # 마른다(프로세스당 상한이 7이다). DB 로 할 일은 위에서 끝났으므로 여기서 돌려준다.
    db.close()

    started = time.perf_counter()
    try:
        answer = run_turn(req.message, history, document_context)
    except AppError:
        raise
    except Exception as e:
        logger.exception("답변 생성 실패")
        raise AppError(
            "서버 오류", "답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.", 500
        ) from e
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return success_response(ChatResponse(answer=answer, response_time_ms=elapsed_ms))


# ── 대화 기록 CRUD ─────────────────────────────────────────────────────


def _uid(user: dict) -> uuid.UUID:
    """검증된 클레임에서 사용자 id(sub)를 uuid 로. 형식이 이상하면 401."""
    try:
        return uuid.UUID(str(user.get("sub", "")))
    except ValueError as e:
        raise AppError(
            "로그인 필요", "사용자 식별에 실패했습니다. 다시 로그인해 주세요.", 401
        ) from e


def _get_owned_room(db: Session, room_id: str, uid: uuid.UUID) -> ChatRoom:
    """내 소유의(삭제 안 된) 방을 반환. 없으면 404(존재 여부 노출 방지)."""
    try:
        rid = uuid.UUID(room_id)
    except ValueError as e:
        raise AppError("대화를 찾을 수 없습니다", _ROOM_NOT_FOUND, 404) from e
    room = db.execute(
        select(ChatRoom).where(
            ChatRoom.id == rid,
            ChatRoom.user_id == uid,
            ChatRoom.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if room is None:
        raise AppError("대화를 찾을 수 없습니다", _ROOM_NOT_FOUND, 404)
    return room



def _room_out(
    room: ChatRoom, file_name: str | None = None, preview: str | None = None
) -> ChatRoomOut:
    """채팅방 응답 필드를 한곳에서 조립해 엔드포인트 사이 누락을 막는다."""
    return ChatRoomOut(
        id=str(room.id),
        title=room.title,
        last_chat_at=room.last_chat_at,
        updated_at=room.updated_at,
        analysis_job_id=str(room.analysis_job_id) if room.analysis_job_id else None,
        analysis_file_name=file_name,
        last_message_preview=preview,
    )


def _attachment_names(db: Session, rooms: Sequence[ChatRoom]) -> dict[uuid.UUID, str | None]:
    """첨부된 방들의 표시용 파일명을 한 번에 읽는다(방마다 조회하면 N+1 이 된다).

    첨부가 하나도 없으면 쿼리 자체를 보내지 않는다 — 첨부는 예외적인 경우라 목록 조회에
    질의를 늘 하나 더 얹을 이유가 없다.
    """
    job_ids = {room.analysis_job_id for room in rooms if room.analysis_job_id}
    if not job_ids:
        return {}
    rows = db.execute(
        select(AnalysisJob.id, AnalysisJob.file_names).where(AnalysisJob.id.in_(job_ids))
    ).all()
    return {job_id: (names[0] if names else None) for job_id, names in rows}


_PREVIEW_MAX_LEN = 80


def _truncate(text: str, limit: int = _PREVIEW_MAX_LEN) -> str:
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _last_message_previews(db: Session, room_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """방마다 가장 최근 메시지 미리보기 한 줄. 목록 카드용이라 길이를 짧게 자른다.

    chat_room_id 로 정렬 후 같은 그룹 안에서 created_at 내림차순 → 그룹의 첫 행이 최신 메시지다.
    방마다 별도 쿼리(N+1)를 피하려고 한 번에 가져와 파이썬에서 그룹 첫 값만 취한다.
    """
    if not room_ids:
        return {}
    rows = db.execute(
        select(ChatMessage.chat_room_id, ChatMessage.content)
        .where(ChatMessage.chat_room_id.in_(room_ids))
        .order_by(ChatMessage.chat_room_id, ChatMessage.created_at.desc(), ChatMessage.id.desc())
    ).all()
    previews: dict[uuid.UUID, str] = {}
    for room_id, content in rows:
        previews.setdefault(room_id, _truncate(content))
    return previews



@router.get("/chat/rooms", response_model=ApiResponse[Page[ChatRoomOut]])
def list_rooms(
    user: RequireMember, db: AppDb, limit: Limit = 30, cursor: str | None = None
) -> ApiResponse[Page[ChatRoomOut]]:
    """내 채팅방 목록 (최신순, 커서 페이지네이션). 아래로 갈수록 오래된 방."""
    uid = _uid(user)
    stmt = (
        select(ChatRoom)
        .where(ChatRoom.user_id == uid, ChatRoom.deleted_at.is_(None))
        .order_by(ChatRoom.last_chat_at.desc(), ChatRoom.id.desc())
        .limit(limit + 1)  # +1 로 다음 페이지 존재 여부 확인
    )
    ck = decode_cursor(cursor)
    if ck is not None:
        c_ts, c_id = ck
        stmt = stmt.where(
            (ChatRoom.last_chat_at < c_ts)
            | ((ChatRoom.last_chat_at == c_ts) & (ChatRoom.id < c_id))
        )
    rows = db.execute(stmt).scalars().all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = encode_cursor(rows[-1].last_chat_at, rows[-1].id) if has_more and rows else None
    names = _attachment_names(db, rows)
    previews = _last_message_previews(db, [r.id for r in rows])
    return success_response(
        Page(
            items=[
                _room_out(
                    r,
                    names.get(r.analysis_job_id) if r.analysis_job_id else None,
                    previews.get(r.id),
                )
                for r in rows
            ],
            next_cursor=next_cursor,
        )
    )


@router.post("/chat/rooms", response_model=ApiResponse[ChatRoomOut])
def create_room(body: CreateRoomIn, user: RequireMember, db: AppDb) -> ApiResponse[ChatRoomOut]:
    """새 채팅방 생성 (user_id = 내 sub)."""
    uid = _uid(user)
    room = ChatRoom(user_id=uid, title=body.title)
    db.add(room)
    db.commit()
    db.refresh(room)
    return success_response(_room_out(room))


@router.get("/chat/rooms/{room_id}/messages", response_model=ApiResponse[Page[ChatMessageOut]])
def list_messages(
    room_id: str, user: RequireMember, db: AppDb, limit: Limit = 30, cursor: str | None = None
) -> ApiResponse[Page[ChatMessageOut]]:
    """특정 방의 메시지 (최신부터 페이지네이션). 방 소유권을 먼저 확인한다.

    채팅은 최신이 아래이므로 내부는 최신 우선(desc)으로 뽑되, items 는 오름차순으로 뒤집어 반환한다.
    next_cursor 는 반환분 중 가장 오래된 행 → 위로 스크롤 시 더 과거를 가져온다.
    """
    uid = _uid(user)
    room = _get_owned_room(db, room_id, uid)
    stmt = (
        select(ChatMessage)
        .where(ChatMessage.chat_room_id == room.id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(limit + 1)
    )
    ck = decode_cursor(cursor)
    if ck is not None:
        c_ts, c_id = ck
        stmt = stmt.where(
            (ChatMessage.created_at < c_ts)
            | ((ChatMessage.created_at == c_ts) & (ChatMessage.id < c_id))
        )
    rows = db.execute(stmt).scalars().all()

    has_more = len(rows) > limit
    rows = rows[:limit]  # 최신순(desc)에서 limit 개
    next_cursor = encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None
    rows = list(reversed(rows))  # 화면 표시용 오름차순(오래된 → 최신)
    return success_response(
        Page(
            items=[
                ChatMessageOut(
                    id=str(m.id), role=m.role, content=m.content, created_at=m.created_at
                )
                for m in rows
            ],
            next_cursor=next_cursor,
        )
    )


@router.post("/chat/rooms/{room_id}/messages", response_model=ApiResponse[ChatMessageOut])
def add_message(
    room_id: str, body: AddMessageIn, user: RequireMember, db: AppDb
) -> ApiResponse[ChatMessageOut]:
    """메시지 저장 + 방 last_chat_at/updated_at 갱신. 소유권 확인 후 진행."""
    uid = _uid(user)
    room = _get_owned_room(db, room_id, uid)
    msg = ChatMessage(
        chat_room_id=room.id,
        role=body.role,
        content=body.content,
        response_time=body.response_time,
    )
    db.add(msg)
    now = monotonic_utcnow()
    room.last_chat_at = now  # 방을 목록 맨 위로(정렬 기준)
    room.updated_at = now
    db.commit()
    db.refresh(msg)
    return success_response(
        ChatMessageOut(
            id=str(msg.id), role=msg.role, content=msg.content, created_at=msg.created_at
        )
    )


@router.put("/chat/rooms/{room_id}/title", response_model=ApiResponse[ChatRoomOut])
def update_room_title(
    room_id: str, body: UpdateRoomTitleIn, user: RequireMember, db: AppDb
) -> ApiResponse[ChatRoomOut]:
    """방 제목 수정. last_chat_at 은 건드리지 않으므로 목록 순서는 그대로 유지된다."""
    uid = _uid(user)
    room = _get_owned_room(db, room_id, uid)
    now = monotonic_utcnow()
    room.title = body.title
    room.title_updated_at = now
    room.updated_at = now
    db.commit()
    db.refresh(room)
    # 파일명까지 채워서 돌려준다 — 프론트가 이 응답으로 목록의 방을 통째로 교체하므로
    # 빼먹으면 이름만 바꿨는데 첨부 칩이 사라진다.
    file_name = _attachment_names(db, [room]).get(room.analysis_job_id)
    # message 는 토스트 문구다 — 프론트가 화면마다 따로 심지 않도록 서버가 소유한다.
    return success_response(_room_out(room, file_name), message="대화 제목을 수정했습니다.")


@router.post("/chat/rooms/{room_id}/document", response_model=ApiResponse[ChatRoomOut])
def attach_document(
    room_id: str, body: AttachDocumentIn, user: RequireMember, db: AppDb
) -> ApiResponse[ChatRoomOut]:
    """완료된 계약서 분석을 방에 첨부한다. 이후 그 방의 모든 질문에 계약서 맥락이 함께 들어간다.

    끝나지 않았거나 실패한 분석은 붙이지 않는다 — 결과(sanitized_text)가 없어 맥락이 비고,
    사용자는 "첨부했는데 계약서를 모른다"는 상태를 만나게 된다.
    last_chat_at 은 건드리지 않는다(첨부는 대화가 아니므로 목록 순서를 바꾸지 않는다).
    """
    uid = _uid(user)
    room = _get_owned_room(db, room_id, uid)

    # 없는 분석·남의 분석·잘못된 UUID 를 한 문구로 묶는다(존재 여부를 알려주지 않는다).
    try:
        job_id = uuid.UUID(body.analysis_job_id)
    except ValueError as e:
        raise AppError("첨부할 수 없습니다", "분석 결과를 찾을 수 없습니다.", 404) from e

    job = AnalysisJobRepository(db).get_owned(job_id, uid)
    if job is None:
        raise AppError("첨부할 수 없습니다", "분석 결과를 찾을 수 없습니다.", 404)
    if job.status != JobStatus.SUCCEEDED.value:
        raise AppError(
            "아직 첨부할 수 없습니다",
            "계약서 분석이 끝난 뒤에 첨부할 수 있습니다.",
            409,
        )

    room.analysis_job_id = job.id
    room.updated_at = monotonic_utcnow()
    db.commit()
    db.refresh(room)
    file_name = job.file_names[0] if job.file_names else None
    return success_response(_room_out(room, file_name), message="계약서를 대화에 첨부했습니다.")


@router.delete("/chat/rooms/{room_id}/document", response_model=ApiResponse[ChatRoomOut])
def detach_document(room_id: str, user: RequireMember, db: AppDb) -> ApiResponse[ChatRoomOut]:
    """첨부만 해제한다. 분석과 위험 보고서는 그대로 남는다."""
    uid = _uid(user)
    room = _get_owned_room(db, room_id, uid)
    room.analysis_job_id = None
    room.updated_at = monotonic_utcnow()
    db.commit()
    db.refresh(room)
    return success_response(_room_out(room), message="계약서 첨부를 해제했습니다.")


@router.delete("/chat/rooms/{room_id}", response_model=ApiResponse[ChatRoomOut])
def delete_room(room_id: str, user: RequireMember, db: AppDb) -> ApiResponse[ChatRoomOut]:
    """방 soft delete — deleted_at 만 찍는다. 행도 메시지도 DB 에서 지우지 않는다.

    목록·메시지 조회가 이미 deleted_at IS NULL 로 걸러내므로 이후 접근은 전부 404 가 된다.
    (db.delete() 를 쓰면 chat_message 가 ON DELETE CASCADE 로 함께 날아간다 — 쓰지 않는다.)
    """
    uid = _uid(user)
    room = _get_owned_room(db, room_id, uid)
    now = monotonic_utcnow()
    room.deleted_at = now
    room.updated_at = now
    db.commit()
    db.refresh(room)
    return success_response(_room_out(room), message="대화를 삭제했습니다.")
