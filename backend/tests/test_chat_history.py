"""대화 기록 CRUD(/api/v1/chat/rooms...) 테스트.

실데이터는 Supabase Postgres 지만, 여기선 conftest 패턴대로 인메모리 SQLite 로 get_app_db 를,
가짜 사용자로 require_user 를 오버라이드해 소유권/격리 로직을 검증한다(네트워크 불필요).
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.deps import require_user
from app.db import session as db_session
from app.db.base import Base
from app.db.session import get_app_db
from app.main import app
from app.models.auth import AppUser, UserAgreement
from app.models.chat import ChatMessage, ChatRoom

USER_A = str(uuid.uuid4())
USER_B = str(uuid.uuid4())


@pytest.fixture()
def history_client():
    """get_app_db → 인메모리 SQLite, require_user → 전환 가능한 가짜 사용자."""
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)
    with TestingSessionLocal() as db:
        user_ids = [uuid.UUID(USER_A), uuid.UUID(USER_B)]
        db.add_all([AppUser(id=user_id) for user_id in user_ids])
        db.add_all(
            [
                UserAgreement(
                    user_id=user_id,
                    agreement_type=agreement_type,
                    version="v1",
                    is_agreed=True,
                )
                for user_id in user_ids
                for agreement_type in ("terms", "privacy")
            ]
        )
        db.commit()

    def override_get_app_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    claims = {"sub": USER_A}

    app.dependency_overrides[get_app_db] = override_get_app_db
    app.dependency_overrides[require_user] = lambda: claims

    def set_user(sub: str) -> None:
        claims["sub"] = sub

    with TestClient(app) as client:
        yield client, set_user
    app.dependency_overrides.clear()


def test_list_rooms_empty(history_client):
    client, _ = history_client
    resp = client.get("/api/v1/chat/rooms")
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["items"] == []
    assert body["next_cursor"] is None


def test_create_and_list_room(history_client):
    client, _ = history_client
    created = client.post("/api/v1/chat/rooms", json={"title": "보증금 반환"})
    assert created.status_code == 200
    room = created.json()["data"]
    assert room["title"] == "보증금 반환"
    assert room["id"]
    assert room["last_chat_at"]

    rooms = client.get("/api/v1/chat/rooms").json()["data"]["items"]
    assert [r["id"] for r in rooms] == [room["id"]]


def test_add_message_and_read_back(history_client):
    client, _ = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "질문"}).json()["data"]["id"]

    client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"role": "USER", "content": "보증금 언제 돌려받나요?"},
    )
    client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"role": "ASSISTANT", "content": "계약 종료 시 반환됩니다.", "response_time": 1200},
    )

    msgs = client.get(f"/api/v1/chat/rooms/{room_id}/messages").json()["data"]["items"]
    assert [m["role"] for m in msgs] == ["USER", "ASSISTANT"]
    assert msgs[0]["content"] == "보증금 언제 돌려받나요?"


def test_last_chat_at_starts_at_registration_and_changes_with_message(history_client):
    client, _ = history_client
    created = client.post("/api/v1/chat/rooms", json={"title": "질문"}).json()["data"]
    initial_last_chat_at = created["last_chat_at"]

    client.post(
        f"/api/v1/chat/rooms/{created['id']}/messages",
        json={"role": "USER", "content": "새 메시지"},
    )

    room = client.get("/api/v1/chat/rooms").json()["data"]["items"][0]
    assert room["last_chat_at"] > initial_last_chat_at


def test_add_message_rejects_oversized_content(history_client):
    """상한(20000자)을 넘는 본문은 422 — 무제한 텍스트가 DB 로 들어가지 못하게 한다."""
    client, _ = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "질문"}).json()["data"]["id"]

    ok = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages", json={"role": "USER", "content": "가" * 20000}
    )
    too_long = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages", json={"role": "USER", "content": "가" * 20001}
    )

    assert ok.status_code == 200
    assert too_long.status_code == 422


def test_add_message_bumps_room_to_top(history_client):
    client, _ = history_client
    first = client.post("/api/v1/chat/rooms", json={"title": "먼저"}).json()["data"]["id"]
    second = client.post("/api/v1/chat/rooms", json={"title": "나중"}).json()["data"]["id"]

    # 먼저 만든 방에 메시지를 넣으면 last_chat_at 이 갱신돼 목록 맨 위로 올라와야 한다.
    client.post(f"/api/v1/chat/rooms/{first}/messages", json={"role": "USER", "content": "안녕"})

    order = [r["id"] for r in client.get("/api/v1/chat/rooms").json()["data"]["items"]]
    assert order[0] == first
    assert set(order) == {first, second}


def test_title_update_keeps_room_order(history_client):
    client, _ = history_client
    first = client.post("/api/v1/chat/rooms", json={"title": "A"}).json()["data"]["id"]
    second = client.post("/api/v1/chat/rooms", json={"title": "B"}).json()["data"]["id"]
    client.post(f"/api/v1/chat/rooms/{first}/messages", json={"role": "USER", "content": "안녕"})

    before = [r["id"] for r in client.get("/api/v1/chat/rooms").json()["data"]["items"]]
    updated = client.put(f"/api/v1/chat/rooms/{second}/title", json={"title": "수정한 B"})
    after = [r["id"] for r in client.get("/api/v1/chat/rooms").json()["data"]["items"]]

    assert updated.status_code == 200
    assert before == [first, second]
    assert after == before


def test_update_room_title_success_and_preserves_last_chat_at(history_client):
    client, _ = history_client
    created = client.post("/api/v1/chat/rooms", json={"title": "기존 제목"}).json()["data"]

    resp = client.put(f"/api/v1/chat/rooms/{created['id']}/title", json={"title": "  새 제목  "})

    assert resp.status_code == 200
    updated = resp.json()["data"]
    assert updated["title"] == "새 제목"
    assert updated["last_chat_at"] == created["last_chat_at"]
    listed = client.get("/api/v1/chat/rooms").json()["data"]["items"][0]
    assert listed["title"] == "새 제목"


@pytest.mark.parametrize("title", ["   ", "가" * 201])
def test_update_room_title_rejects_invalid_title(history_client, title):
    client, _ = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "기존 제목"}).json()["data"]["id"]

    resp = client.put(f"/api/v1/chat/rooms/{room_id}/title", json={"title": title})

    assert resp.status_code == 422
    assert resp.json()["error"]["title"] == "입력값 오류"


def test_update_others_room_404(history_client):
    client, set_user = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "A"}).json()["data"]["id"]

    set_user(USER_B)
    resp = client.put(f"/api/v1/chat/rooms/{room_id}/title", json={"title": "침입"})

    assert resp.status_code == 404
    assert resp.json()["error"]["title"] == "대화를 찾을 수 없습니다"


def test_delete_room_hides_it_and_preserves_rows(history_client):
    client, _ = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "삭제할 방"}).json()["data"]["id"]
    client.post(
        f"/api/v1/chat/rooms/{room_id}/messages",
        json={"role": "USER", "content": "남아 있어야 하는 메시지"},
    )

    deleted = client.delete(f"/api/v1/chat/rooms/{room_id}")

    assert deleted.status_code == 200
    assert deleted.json()["data"]["id"] == room_id
    assert client.get("/api/v1/chat/rooms").json()["data"]["items"] == []
    messages = client.get(f"/api/v1/chat/rooms/{room_id}/messages")
    assert messages.status_code == 404
    assert messages.json()["error"]["title"] == "대화를 찾을 수 없습니다"
    deleted_again = client.delete(f"/api/v1/chat/rooms/{room_id}")
    assert deleted_again.status_code == 404
    assert deleted_again.json()["error"]["title"] == "대화를 찾을 수 없습니다"

    # API 에서는 사라져도 감사·복구를 위해 방과 메시지 행은 실제 DB 에 그대로 남아야 한다.
    db_override = app.dependency_overrides[get_app_db]()
    db = next(db_override)
    try:
        room = db.execute(select(ChatRoom).where(ChatRoom.id == uuid.UUID(room_id))).scalar_one()
        message_rows = (
            db.execute(select(ChatMessage).where(ChatMessage.chat_room_id == room.id))
            .scalars()
            .all()
        )
        assert room.deleted_at is not None
        assert len(message_rows) == 1
        assert message_rows[0].content == "남아 있어야 하는 메시지"
    finally:
        db.close()
        db_override.close()


def test_delete_others_room_404(history_client):
    client, set_user = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "A"}).json()["data"]["id"]

    set_user(USER_B)
    resp = client.delete(f"/api/v1/chat/rooms/{room_id}")

    assert resp.status_code == 404
    assert resp.json()["error"]["title"] == "대화를 찾을 수 없습니다"


def test_rooms_isolated_between_users(history_client):
    client, set_user = history_client
    set_user(USER_A)
    client.post("/api/v1/chat/rooms", json={"title": "A 의 방"})

    set_user(USER_B)
    assert client.get("/api/v1/chat/rooms").json()["data"]["items"] == []  # B 는 A 방이 안 보인다


def test_cross_user_room_messages_404(history_client):
    client, set_user = history_client
    set_user(USER_A)
    room_id = client.post("/api/v1/chat/rooms", json={"title": "A"}).json()["data"]["id"]

    set_user(USER_B)
    resp = client.get(f"/api/v1/chat/rooms/{room_id}/messages")
    assert resp.status_code == 404
    assert resp.json()["error"]["title"] == "대화를 찾을 수 없습니다"


def test_add_message_to_others_room_404(history_client):
    client, set_user = history_client
    set_user(USER_A)
    room_id = client.post("/api/v1/chat/rooms", json={"title": "A"}).json()["data"]["id"]

    set_user(USER_B)
    resp = client.post(
        f"/api/v1/chat/rooms/{room_id}/messages", json={"role": "USER", "content": "침입"}
    )
    assert resp.status_code == 404


def test_rooms_requires_auth(client):
    """require_user 오버라이드 없는 기본 client → 인증 없이 접근 시 401."""
    resp = client.get("/api/v1/chat/rooms")
    assert resp.status_code == 401
    assert resp.json()["error"]["title"] == "로그인 필요"


@pytest.mark.parametrize("method,path", [("put", "/title"), ("delete", "")])
def test_room_mutations_require_auth(client, method, path):
    room_id = str(uuid.uuid4())
    request = getattr(client, method)
    kwargs = {"json": {"title": "새 제목"}} if method == "put" else {}

    resp = request(f"/api/v1/chat/rooms/{room_id}{path}", **kwargs)

    assert resp.status_code == 401
    assert resp.json()["error"]["title"] == "로그인 필요"


# ── 응답 봉투 정책 (message=토스트 / error=모달) ────────────────────────


def test_mutations_carry_toast_message(history_client):
    """수정·삭제는 사용자에게 알릴 게 있으므로 봉투 message(=토스트)를 채운다."""
    client, _ = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "A"}).json()["data"]["id"]

    renamed = client.put(f"/api/v1/chat/rooms/{room_id}/title", json={"title": "B"})
    deleted = client.delete(f"/api/v1/chat/rooms/{room_id}")

    assert renamed.json()["message"] == "대화 제목을 수정했습니다."
    assert deleted.json()["message"] == "대화를 삭제했습니다."


def test_reads_have_no_toast_message(history_client):
    """조회·생성은 알릴 게 없다 — message 가 비어야 프론트가 토스트를 띄우지 않는다."""
    client, _ = history_client
    created = client.post("/api/v1/chat/rooms", json={"title": "A"})
    listed = client.get("/api/v1/chat/rooms")

    assert created.json()["message"] == ""
    assert listed.json()["message"] == ""


def test_error_fills_only_modal_fields(history_client):
    """실패는 모달(error.title/message)로만 간다.

    봉투 message 까지 채우면 같은 문장이 토스트와 모달에 두 번 뜬다.
    """
    client, _ = history_client

    body = client.delete(f"/api/v1/chat/rooms/{uuid.uuid4()}").json()

    assert body["message"] == ""
    assert body["error"] == {
        "title": "대화를 찾을 수 없습니다",
        "message": "이미 삭제되었거나 존재하지 않는 대화입니다.",
    }


def test_history_unavailable_returns_503(monkeypatch):
    """저장소 미설정(AppSessionLocal None)이면 503."""
    monkeypatch.setattr(db_session, "AppSessionLocal", None)
    app.dependency_overrides[require_user] = lambda: {"sub": USER_A}
    try:
        with TestClient(app) as client:
            resp = client.get("/api/v1/chat/rooms")
        assert resp.status_code == 503
        assert resp.json()["error"]["title"] == "대화 기록 사용 불가"
    finally:
        app.dependency_overrides.clear()


# ── 커서 페이지네이션 ──────────────────────────────────────────────────


def test_rooms_pagination_by_cursor(history_client):
    client, _ = history_client
    for i in range(35):
        client.post("/api/v1/chat/rooms", json={"title": f"방 {i}"})

    page1 = client.get("/api/v1/chat/rooms?limit=30").json()["data"]
    assert len(page1["items"]) == 30
    assert page1["next_cursor"] is not None

    page2 = client.get(f"/api/v1/chat/rooms?limit=30&cursor={page1['next_cursor']}").json()["data"]
    assert len(page2["items"]) == 5
    assert page2["next_cursor"] is None

    # 두 페이지 사이 중복 없음(keyset 경계 정확).
    ids1 = {r["id"] for r in page1["items"]}
    ids2 = {r["id"] for r in page2["items"]}
    assert ids1.isdisjoint(ids2)


def test_messages_pagination_latest_first(history_client):
    client, _ = history_client
    room_id = client.post("/api/v1/chat/rooms", json={"title": "긴 대화"}).json()["data"]["id"]
    for i in range(35):
        client.post(
            f"/api/v1/chat/rooms/{room_id}/messages",
            json={"role": "USER", "content": f"메시지 {i:02d}"},
        )

    # 1페이지 = 최신 30개를 오름차순(마지막이 가장 최근)으로.
    page1 = client.get(f"/api/v1/chat/rooms/{room_id}/messages?limit=30").json()["data"]
    assert len(page1["items"]) == 30
    assert page1["items"][-1]["content"] == "메시지 34"  # 가장 최근
    assert page1["items"][0]["content"] == "메시지 05"  # 최신 30개 중 가장 오래된
    assert page1["next_cursor"] is not None

    # 커서로 더 과거 5개.
    url = f"/api/v1/chat/rooms/{room_id}/messages?limit=30&cursor={page1['next_cursor']}"
    page2 = client.get(url).json()["data"]
    assert [m["content"] for m in page2["items"]] == [f"메시지 {i:02d}" for i in range(5)]
    assert page2["next_cursor"] is None
