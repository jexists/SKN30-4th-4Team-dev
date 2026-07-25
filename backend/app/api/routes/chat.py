"""AI 챗봇 엔드포인트 — LangGraph RAG 답변(app.agent.graph_rag) + 대화 기록 CRUD.

멀티턴 맥락은 요청의 history 로 주입한다(프론트가 최근 N개를 함께 보낸다). 대화 기록(방·메시지)의
저장·조회는 이 라우터가 담당한다 — 백엔드가 Supabase Postgres 에 연결하고, 연결 role 이 RLS 를
우회하므로 소유권(user_id==sub)은 코드가 직접 검증한다.
"""

import base64
import json
import time
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import RequireUser
from app.core.exceptions import AppError
from app.db.session import get_app_db
from app.models.chat import ChatMessage, ChatRoom, monotonic_utcnow
from app.schemas.chat import (
    AddMessageIn,
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    ChatRoomOut,
    CreateRoomIn,
)
from app.schemas.common import ApiResponse, Page, success_response

router = APIRouter(tags=["chat"])

AppDb = Annotated[Session, Depends(get_app_db)]

# 페이지네이션 파라미터: 기본 30개, 1~100 클램프.
Limit = Annotated[int, Query(ge=1, le=100)]

# graph_rag 는 langgraph·langchain-openai 를 요구하므로 지연 로드한다.
# (미설치·초기화 실패해도 서버 기동과 다른 엔드포인트는 영향받지 않는다.)
_run_turn = None


def _get_run_turn():
    global _run_turn
    if _run_turn is None:
        try:
            from app.agent.graph_rag import run_turn
        except Exception as e:  # 의존성 미설치 / 초기화 실패
            raise AppError(
                "CHAT_UNAVAILABLE",
                "챗봇 엔진을 불러오지 못했습니다. "
                f"의존성(langgraph·langchain-openai) 설치가 필요합니다: {e}",
                503,
            ) from e
        _run_turn = run_turn
    return _run_turn


@router.post("/chat", response_model=ApiResponse[ChatResponse])
def chat(req: ChatRequest) -> ApiResponse[ChatResponse]:
    """한 턴을 처리하고 답변 + 응답시간(ms)을 돌려준다.

    동기 함수라 FastAPI 가 스레드풀에서 실행 → OpenAI 블로킹 호출이 이벤트 루프를 막지 않는다.
    """
    run_turn = _get_run_turn()
    history = [t.model_dump() for t in req.history]
    started = time.perf_counter()
    try:
        answer = run_turn(req.message, history)
    except AppError:
        raise
    except Exception as e:
        raise AppError("CHAT_ERROR", f"답변 생성 중 오류가 발생했습니다: {e}", 500) from e
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return success_response(ChatResponse(answer=answer, response_time_ms=elapsed_ms))


# ── 대화 기록 CRUD ─────────────────────────────────────────────────────


def _uid(user: dict) -> uuid.UUID:
    """검증된 클레임에서 사용자 id(sub)를 uuid 로. 형식이 이상하면 401."""
    try:
        return uuid.UUID(str(user.get("sub", "")))
    except ValueError as e:
        raise AppError("UNAUTHORIZED", "사용자 식별에 실패했습니다.", 401) from e


def _get_owned_room(db: Session, room_id: str, uid: uuid.UUID) -> ChatRoom:
    """내 소유의(삭제 안 된) 방을 반환. 없으면 404(존재 여부 노출 방지)."""
    try:
        rid = uuid.UUID(room_id)
    except ValueError as e:
        raise AppError("NOT_FOUND", "대화를 찾을 수 없습니다.", 404) from e
    room = db.execute(
        select(ChatRoom).where(
            ChatRoom.id == rid,
            ChatRoom.user_id == uid,
            ChatRoom.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if room is None:
        raise AppError("NOT_FOUND", "대화를 찾을 수 없습니다.", 404)
    return room


# ── 커서(keyset) 페이지네이션 ──────────────────────────────────────────
# 커서 = 마지막으로 본 행의 (정렬 시각, id). base64(JSON) 불투명 문자열 — 프론트는 저장·재전달만.


def _encode_cursor(ts: datetime, id_: uuid.UUID) -> str:
    raw = json.dumps({"t": ts.isoformat(), "i": str(id_)})
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(raw: str | None) -> tuple[datetime, uuid.UUID] | None:
    """커서를 (ts, id) 로. 없거나 손상됐으면 None → 첫 페이지로 취급(fail-soft)."""
    if not raw:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(raw.encode()).decode())
        return datetime.fromisoformat(data["t"]), uuid.UUID(data["i"])
    except (ValueError, KeyError, TypeError):
        return None


@router.get("/chat/rooms", response_model=ApiResponse[Page[ChatRoomOut]])
def list_rooms(
    user: RequireUser, db: AppDb, limit: Limit = 30, cursor: str | None = None
) -> ApiResponse[Page[ChatRoomOut]]:
    """내 채팅방 목록 (최신순, 커서 페이지네이션). 아래로 갈수록 오래된 방."""
    uid = _uid(user)
    stmt = (
        select(ChatRoom)
        .where(ChatRoom.user_id == uid, ChatRoom.deleted_at.is_(None))
        .order_by(ChatRoom.updated_at.desc(), ChatRoom.id.desc())
        .limit(limit + 1)  # +1 로 다음 페이지 존재 여부 확인
    )
    ck = _decode_cursor(cursor)
    if ck is not None:
        c_ts, c_id = ck
        stmt = stmt.where(
            (ChatRoom.updated_at < c_ts) | ((ChatRoom.updated_at == c_ts) & (ChatRoom.id < c_id))
        )
    rows = db.execute(stmt).scalars().all()

    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = _encode_cursor(rows[-1].updated_at, rows[-1].id) if has_more and rows else None
    return success_response(
        Page(
            items=[ChatRoomOut(id=str(r.id), title=r.title, updated_at=r.updated_at) for r in rows],
            next_cursor=next_cursor,
        )
    )


@router.post("/chat/rooms", response_model=ApiResponse[ChatRoomOut])
def create_room(body: CreateRoomIn, user: RequireUser, db: AppDb) -> ApiResponse[ChatRoomOut]:
    """새 채팅방 생성 (user_id = 내 sub)."""
    uid = _uid(user)
    room = ChatRoom(user_id=uid, title=body.title)
    db.add(room)
    db.commit()
    db.refresh(room)
    return success_response(
        ChatRoomOut(id=str(room.id), title=room.title, updated_at=room.updated_at)
    )


@router.get("/chat/rooms/{room_id}/messages", response_model=ApiResponse[Page[ChatMessageOut]])
def list_messages(
    room_id: str, user: RequireUser, db: AppDb, limit: Limit = 30, cursor: str | None = None
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
    ck = _decode_cursor(cursor)
    if ck is not None:
        c_ts, c_id = ck
        stmt = stmt.where(
            (ChatMessage.created_at < c_ts)
            | ((ChatMessage.created_at == c_ts) & (ChatMessage.id < c_id))
        )
    rows = db.execute(stmt).scalars().all()

    has_more = len(rows) > limit
    rows = rows[:limit]  # 최신순(desc)에서 limit 개
    next_cursor = _encode_cursor(rows[-1].created_at, rows[-1].id) if has_more and rows else None
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
    room_id: str, body: AddMessageIn, user: RequireUser, db: AppDb
) -> ApiResponse[ChatMessageOut]:
    """메시지 저장 + 방 updated_at 갱신(목록 최신순 정렬용). 소유권 확인 후 진행."""
    uid = _uid(user)
    room = _get_owned_room(db, room_id, uid)
    msg = ChatMessage(
        chat_room_id=room.id,
        role=body.role,
        content=body.content,
        response_time=body.response_time,
    )
    db.add(msg)
    room.updated_at = monotonic_utcnow()  # 방을 목록 맨 위로(단조 증가 보장)
    db.commit()
    db.refresh(msg)
    return success_response(
        ChatMessageOut(
            id=str(msg.id), role=msg.role, content=msg.content, created_at=msg.created_at
        )
    )
