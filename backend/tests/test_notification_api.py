"""알림 API — 목록·필터·개수·읽음·삭제·소유권."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.api.deps import require_user
from app.main import app
from app.models.notification import Notification, NotificationType

BASE_TIME = datetime(2026, 7, 30, 12, 0, tzinfo=UTC)


@pytest.fixture()
def member(client, register_member):
    user_id = register_member()
    app.dependency_overrides[require_user] = lambda: {"sub": str(user_id)}
    return client, user_id


def _seed(db_sessionmaker, user_id: uuid.UUID, count: int, *, read: int = 0):
    ids = []
    with db_sessionmaker() as db:
        for index in range(count):
            row = Notification(
                user_id=user_id,
                type=NotificationType.GENERAL.value,
                title=f"알림 {index}",
                content="본문",
                created_at=BASE_TIME + timedelta(minutes=index),
                read_at=BASE_TIME if index < read else None,
            )
            db.add(row)
            db.flush()
            ids.append(row.id)
        db.commit()
    return ids


def _delete(client, body):
    # httpx 의 delete() 는 body 를 받지 않는다.
    return client.request("DELETE", "/api/v1/notifications", json=body)


# ── 목록 ──────────────────────────────────────────────────────────────


def test_lists_newest_first_with_cursor(member, db_sessionmaker):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 5)

    first = client.get("/api/v1/notifications?limit=2").json()["data"]
    assert [n["title"] for n in first["items"]] == ["알림 4", "알림 3"]
    assert first["next_cursor"]
    # 조회 API 는 토스트를 띄우지 않는다.
    assert client.get("/api/v1/notifications").json()["message"] == ""

    second = client.get(
        f"/api/v1/notifications?limit=2&cursor={first['next_cursor']}"
    ).json()["data"]
    assert [n["title"] for n in second["items"]] == ["알림 2", "알림 1"]


def test_unread_filter_is_applied_on_the_server(member, db_sessionmaker):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 5, read=3)

    body = client.get("/api/v1/notifications?unread=true").json()["data"]

    assert [n["title"] for n in body["items"]] == ["알림 4", "알림 3"]
    assert all(n["read_at"] is None for n in body["items"])


def test_payload_exposes_read_at_and_resource_but_not_deleted_at(member, db_sessionmaker):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 1)

    item = client.get("/api/v1/notifications").json()["data"]["items"][0]

    assert set(item) == {
        "id",
        "type",
        "title",
        "content",
        "resource_type",
        "resource_id",
        "read_at",
        "created_at",
    }


def test_unread_count(member, db_sessionmaker):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 5, read=2)

    assert client.get("/api/v1/notifications/unread-count").json()["data"]["count"] == 3


# ── 읽음 ──────────────────────────────────────────────────────────────


def test_marks_selected_as_read_without_a_toast(member, db_sessionmaker):
    """행을 눌러 하나씩 읽을 때마다 토스트가 뜨면 시끄럽다."""
    client, user_id = member
    ids = _seed(db_sessionmaker, user_id, 3)

    body = client.patch("/api/v1/notifications/read", json={"ids": [str(ids[0])]}).json()

    assert body["data"] == {"affected": 1, "unread_count": 2}
    assert body["message"] == ""


def test_marks_all_as_read_with_a_toast(member, db_sessionmaker):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 3)

    body = client.patch("/api/v1/notifications/read", json={}).json()

    assert body["data"] == {"affected": 3, "unread_count": 0}
    assert body["message"] == "모든 알림을 읽음 처리했습니다."


def test_marking_already_read_reports_nothing_changed(member, db_sessionmaker):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 2, read=2)

    body = client.patch("/api/v1/notifications/read", json={}).json()

    assert body["data"]["affected"] == 0
    assert body["message"] == ""


# ── 삭제 ──────────────────────────────────────────────────────────────


def test_deletes_selected(member, db_sessionmaker):
    client, user_id = member
    ids = _seed(db_sessionmaker, user_id, 3)

    body = _delete(client, {"ids": [str(ids[0]), str(ids[1])]}).json()

    assert body["data"]["affected"] == 2
    assert body["message"] == "알림 2개를 삭제했습니다."
    assert len(client.get("/api/v1/notifications").json()["data"]["items"]) == 1


def test_deletes_all(member, db_sessionmaker):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 3)

    body = _delete(client, {}).json()

    assert body["data"] == {"affected": 3, "unread_count": 0}
    assert body["message"] == "모든 알림을 삭제했습니다."
    assert client.get("/api/v1/notifications").json()["data"]["items"] == []


def test_deleted_rows_survive_in_the_table(member, db_sessionmaker):
    """soft delete 다 — 감사·중복 방지를 위해 행 자체는 남는다."""
    client, user_id = member
    _seed(db_sessionmaker, user_id, 2)

    _delete(client, {})

    with db_sessionmaker() as db:
        rows = db.execute(select(Notification)).scalars().all()
        assert len(rows) == 2
        assert all(row.deleted_at is not None for row in rows)


def test_empty_id_list_changes_nothing(member, db_sessionmaker):
    """ids=[] 를 "전체"로 취급하면 아무것도 고르지 않은 요청이 전체 삭제로 돌변한다."""
    client, user_id = member
    _seed(db_sessionmaker, user_id, 3)

    assert _delete(client, {"ids": []}).json()["data"]["affected"] == 0
    assert len(client.get("/api/v1/notifications").json()["data"]["items"]) == 3


def test_too_many_ids_are_rejected(member, db_sessionmaker):
    client, user_id = member

    response = _delete(client, {"ids": [str(uuid.uuid4()) for _ in range(201)]})

    assert response.status_code == 422


# ── 소유권 ────────────────────────────────────────────────────────────


def test_other_users_notifications_are_invisible(member, db_sessionmaker, register_member):
    client, _ = member
    stranger = register_member()
    _seed(db_sessionmaker, stranger, 3)

    assert client.get("/api/v1/notifications").json()["data"]["items"] == []
    assert client.get("/api/v1/notifications/unread-count").json()["data"]["count"] == 0


def test_other_users_ids_are_silently_ignored(member, db_sessionmaker, register_member):
    client, user_id = member
    _seed(db_sessionmaker, user_id, 1)
    stranger = register_member()
    stranger_ids = _seed(db_sessionmaker, stranger, 1)

    body = _delete(client, {"ids": [str(stranger_ids[0])]}).json()

    assert body["data"]["affected"] == 0
    with db_sessionmaker() as db:
        row = db.execute(
            select(Notification).where(Notification.id == stranger_ids[0])
        ).scalar_one()
        assert row.deleted_at is None
