import uuid

import httpx
import pytest

from app.core import config
from app.core.exceptions import AppError
from app.services.analysis_jobs import input_store

USER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
JOB_ID = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
BASE_URL = "https://example.supabase.co"
SERVICE_KEY = "test-service-role-key"


@pytest.fixture(autouse=True)
def storage_settings(monkeypatch):
    monkeypatch.setattr(config.settings, "SUPABASE_URL", BASE_URL)
    monkeypatch.setattr(config.settings, "SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
    monkeypatch.setattr(config.settings, "ANALYSIS_INPUT_BUCKET", "analysis-inputs")
    monkeypatch.setattr(config.settings, "ANALYSIS_STORAGE_TIMEOUT_SECONDS", 60.0)


def _response(status_code: int, content: bytes = b"") -> httpx.Response:
    return httpx.Response(status_code, content=content)


def test_store_all_uses_stable_private_object_keys(monkeypatch):
    calls = []

    def fake_post(url, **kwargs):
        calls.append((url, kwargs))
        return _response(200)

    monkeypatch.setattr(input_store.httpx, "post", fake_post)

    input_store.store_all(
        USER_ID,
        JOB_ID,
        [("../../secret-name.pdf", b"first"), ("second.png", b"second")],
    )

    assert [call[0] for call in calls] == [
        f"{BASE_URL}/storage/v1/object/analysis-inputs/{USER_ID}/{JOB_ID}/000",
        f"{BASE_URL}/storage/v1/object/analysis-inputs/{USER_ID}/{JOB_ID}/001",
    ]
    assert [call[1]["content"] for call in calls] == [b"first", b"second"]
    assert calls[0][1]["headers"] == {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "apikey": SERVICE_KEY,
        "Content-Type": "application/pdf",
        "x-upsert": "true",
    }
    assert calls[1][1]["headers"]["Content-Type"] == "image/png"
    assert calls[0][1]["timeout"] == 60.0
    assert "secret-name" not in calls[0][0]


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("contract.pdf", "application/pdf"),
        ("scan.png", "image/png"),
        ("photo.jpg", "image/jpeg"),
        ("PHOTO.JPEG", "image/jpeg"),
    ],
)
def test_store_all_sends_content_type_from_suffix(monkeypatch, filename, expected):
    calls = []

    def fake_post(_url, **kwargs):
        calls.append(kwargs)
        return _response(200)

    monkeypatch.setattr(input_store.httpx, "post", fake_post)

    input_store.store_all(USER_ID, JOB_ID, [(filename, b"content")])

    assert calls[0]["headers"]["Content-Type"] == expected


def test_store_all_cleans_partial_upload_before_raising(monkeypatch):
    post_count = 0
    deletes = []

    def fake_post(_url, **_kwargs):
        nonlocal post_count
        post_count += 1
        return _response(200 if post_count == 1 else 500)

    def fake_request(method, url, **kwargs):
        deletes.append((method, url, kwargs))
        return _response(200)

    monkeypatch.setattr(input_store.httpx, "post", fake_post)
    monkeypatch.setattr(input_store.httpx, "request", fake_request)

    with pytest.raises(AppError) as caught:
        input_store.store_all(USER_ID, JOB_ID, [("one.pdf", b"1"), ("two.pdf", b"2")])

    assert caught.value.code == 503
    assert len(deletes) == 1
    assert deletes[0][0] == "DELETE"
    assert deletes[0][2]["json"] == {
        "prefixes": [f"{USER_ID}/{JOB_ID}/000", f"{USER_ID}/{JOB_ID}/001"]
    }


@pytest.mark.parametrize(
    ("result", "expected_code"),
    [
        (_response(400), 502),
        (_response(429), 503),
        (_response(503), 503),
        (httpx.ConnectError("offline"), 503),
    ],
)
def test_store_all_maps_storage_failures(monkeypatch, result, expected_code):
    def fake_post(_url, **_kwargs):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(input_store.httpx, "post", fake_post)
    monkeypatch.setattr(input_store.httpx, "request", lambda *_args, **_kwargs: _response(200))

    with pytest.raises(AppError) as caught:
        input_store.store_all(USER_ID, JOB_ID, [("one.pdf", b"1")])

    assert caught.value.code == expected_code


def test_load_reads_authenticated_private_object(monkeypatch):
    calls = []

    def fake_get(url, **kwargs):
        calls.append((url, kwargs))
        return _response(200, b"document")

    monkeypatch.setattr(input_store.httpx, "get", fake_get)

    assert input_store.load(USER_ID, JOB_ID, 2) == b"document"
    assert calls[0][0] == (
        f"{BASE_URL}/storage/v1/object/authenticated/analysis-inputs/{USER_ID}/{JOB_ID}/002"
    )
    assert calls[0][1]["headers"] == {
        "Authorization": f"Bearer {SERVICE_KEY}",
        "apikey": SERVICE_KEY,
    }


@pytest.mark.parametrize(
    ("result", "expected_code"),
    [
        (_response(404), 422),
        (
            _response(
                400,
                b'{"statusCode":"404","error":"not_found","message":"Object not found",'
                b'"code":"NoSuchKey"}',
            ),
            422,
        ),
        (_response(400), 502),
        (_response(500), 503),
        (httpx.ReadTimeout("slow"), 503),
    ],
)
def test_load_maps_missing_and_transient_failures(monkeypatch, result, expected_code):
    def fake_get(_url, **_kwargs):
        if isinstance(result, Exception):
            raise result
        return result

    monkeypatch.setattr(input_store.httpx, "get", fake_get)

    with pytest.raises(AppError) as caught:
        input_store.load(USER_ID, JOB_ID, 0)

    assert caught.value.code == expected_code
    if expected_code == 422:
        assert caught.value.message == "업로드한 파일을 찾지 못했습니다. 다시 업로드해 주세요."


@pytest.mark.parametrize("failure", [_response(404), _response(500), RuntimeError("boom")])
def test_discard_is_best_effort(monkeypatch, failure):
    def fake_request(_method, _url, **_kwargs):
        if isinstance(failure, Exception):
            raise failure
        return failure

    monkeypatch.setattr(input_store.httpx, "request", fake_request)

    assert input_store.discard(USER_ID, JOB_ID, 2) is None


def test_discard_without_count_sends_exact_possible_keys(monkeypatch):
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        return _response(200)

    monkeypatch.setattr(config.settings, "CONTRACT_MAX_FILES", 3)
    monkeypatch.setattr(input_store.httpx, "request", fake_request)

    input_store.discard(USER_ID, JOB_ID)

    assert calls[0][2]["json"] == {
        "prefixes": [
            f"{USER_ID}/{JOB_ID}/000",
            f"{USER_ID}/{JOB_ID}/001",
            f"{USER_ID}/{JOB_ID}/002",
        ]
    }


def test_missing_configuration_is_503_but_discard_stays_non_raising(monkeypatch):
    monkeypatch.setattr(config.settings, "SUPABASE_SERVICE_ROLE_KEY", "")

    with pytest.raises(AppError) as caught:
        input_store.load(USER_ID, JOB_ID, 0)

    assert caught.value.code == 503
    assert input_store.discard(USER_ID, JOB_ID, 1) is None
