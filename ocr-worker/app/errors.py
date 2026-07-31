class OcrProcessingError(Exception):
    """외부에 노출해도 안전한 OCR 오류 코드만 운반한다."""

    def __init__(self, code: str, *, http_status: int = 422):
        self.code = code
        self.http_status = http_status
        super().__init__(code)


class PiiRemainsError(OcrProcessingError):
    def __init__(self):
        super().__init__("PII_REMAINS")
