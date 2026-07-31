import logging
from io import BytesIO

import pytest

from app import serverless_handler
from app.core.config import settings
from app.errors import OcrProcessingError


class _Response(BytesIO):
    def __init__(self, content: bytes, content_length: int | None = None):
        super().__init__(content)
        self.headers = {}
        if content_length is not None:
            self.headers["Content-Length"] = str(content_length)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()


def test_source_url_allows_only_configured_https_supabase_host(monkeypatch):
    monkeypatch.setattr(settings, "OCR_SOURCE_ALLOWED_HOST", "project.supabase.co")

    assert serverless_handler._validate_source_url(
        "https://project.supabase.co/storage/v1/object/sign/x?token=secret"
    ).startswith("https://project.supabase.co/")
    for rejected in (
        "http://project.supabase.co/file",
        "https://evil.example/file",
        "https://project.supabase.co.evil.example/file",
        "https://user@project.supabase.co/file",
    ):
        with pytest.raises(OcrProcessingError):
            serverless_handler._validate_source_url(rejected)


def test_streaming_download_rejects_content_length_over_20mb(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "OCR_MAX_FILE_MB", 20)

    class _Opener:
        def open(self, *_args, **_kwargs):
            return _Response(b"", 20 * 1024 * 1024 + 1)

    monkeypatch.setattr(serverless_handler, "build_opener", lambda *_args: _Opener())

    with pytest.raises(OcrProcessingError) as caught:
        serverless_handler._download("https://project.supabase.co/signed", tmp_path / "x.pdf")
    assert caught.value.code == "FILE_TOO_LARGE"


def test_streaming_download_rejects_body_over_20mb_without_content_length(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "OCR_MAX_FILE_MB", 20)

    class _Opener:
        def open(self, *_args, **_kwargs):
            return _Response(b"x" * (20 * 1024 * 1024 + 1))

    monkeypatch.setattr(serverless_handler, "build_opener", lambda *_args: _Opener())

    with pytest.raises(OcrProcessingError) as caught:
        serverless_handler._download("https://project.supabase.co/signed", tmp_path / "x.pdf")
    assert caught.value.code == "FILE_TOO_LARGE"


def test_handler_returns_safe_error_and_never_logs_input_secrets(monkeypatch, caplog):
    signed_url = "https://project.supabase.co/private?token=signed-secret"
    ocr_text = "주민등록번호 000000-0000000"
    monkeypatch.setattr(settings, "OCR_SOURCE_ALLOWED_HOST", "project.supabase.co")

    def fail_download(*_args, **_kwargs):
        raise RuntimeError(ocr_text)

    monkeypatch.setattr(serverless_handler, "_download", fail_download)
    with caplog.at_level(logging.INFO):
        result = serverless_handler.handler(
            {
                "id": "runpod-job-1",
                "input": {
                    "source_url": signed_url,
                    "filename": "secret-contract.pdf",
                    "content_type": "application/pdf",
                },
            }
        )

    assert result == {"error": {"code": "OCR_INTERNAL_ERROR"}}
    assert signed_url not in caplog.text
    assert ocr_text not in caplog.text
    assert "secret-contract" not in caplog.text
