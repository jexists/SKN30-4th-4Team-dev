                    "OCR 서버 연결 실패",
                    "OCR 처리 서버와 통신하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                    503,
                ) from exc

            if response.status_code == 404 and path.startswith("/status/"):
                raise OcrTransportError(
                    "RUNPOD_JOB_EXPIRED",
                    "OCR 작업 만료",
                    "OCR 작업 결과가 만료되었습니다. 다시 시도해 주세요.",
                    504,
                )
            if response.status_code == 429 or response.status_code >= 500:
                if attempt >= _TRANSIENT_REQUEST_ATTEMPTS or time.monotonic() >= deadline:
                    code = 429 if response.status_code == 429 else 503
                    raise OcrTransportError(
                        "RUNPOD_RATE_LIMITED" if code == 429 else "RUNPOD_UNAVAILABLE",
                        "OCR 서버 요청 제한" if code == 429 else "OCR 서버 장애",
                        "OCR 요청이 일시적으로 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
                        code,
                    )
                delay = min(0.5 * (2 ** (attempt - 1)), 8.0) * (0.5 + random.random() / 2)
                time.sleep(min(delay, max(deadline - time.monotonic(), 0)))
                continue
            if not 200 <= response.status_code < 300:
                logger.warning(
                    "RunPod API 요청 거부 operation=%s status=%d",
                    path.split("/")[1],
                    response.status_code,
                )
                raise AppError("OCR 서버 요청 실패", "OCR 서버가 요청을 처리하지 못했습니다.", 502)
            try:
                payload = response.json()
            except ValueError as exc:
                raise AppError(
                    "OCR 서버 응답 오류", "OCR 서버 응답을 확인하지 못했습니다.", 502
                ) from exc
            if not isinstance(payload, dict):
                raise AppError("OCR 서버 응답 오류", "OCR 서버 응답을 확인하지 못했습니다.", 502)
            return payload

    def cancel(self, job_id: str) -> None:
        try:
            httpx.post(
                f"{self.base_url}/cancel/{job_id}",
                headers=self.headers,
                timeout=settings.RUNPOD_HTTP_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError:
            logger.warning("RunPod OCR 취소 요청 실패 runpod_job_id=%s", job_id)


class OcrWorkerClient:
    """설정에 따라 기존 direct HTTP 또는 RunPod Serverless transport를 선택한다."""

    @staticmethod
    def _base_headers() -> dict[str, str]:
        return DirectHttpTransport.base_headers()

    @property
    def is_serverless(self) -> bool:
        return settings.OCR_TRANSPORT.strip().lower() == "runpod_serverless"

    def health(self) -> OcrWorkerHealth:
        if self.is_serverless:
            if not settings.RUNPOD_ENDPOINT_ID.strip() or not settings.RUNPOD_API_KEY.strip():
                raise OcrTransportError(
                    "RUNPOD_CONFIG_INVALID",
                    "OCR 서버 설정 오류",
                    "OCR 처리 서버가 설정되지 않았습니다.",
                    503,
                )
            return OcrWorkerHealth(status="ok", model="runpod-serverless", model_loaded=False)
        return DirectHttpTransport().health()

    def process_for_analysis(
        self,
        filename: str,
        content: bytes | None = None,
        *,
        source_url_factory: SignedUrlFactory | None = None,
        external_job_id: str | None = None,
        on_submitted: ExternalJobCallback | None = None,
        on_status: StatusCallback | None = None,
    ) -> OcrAnalysisResult:
        if not self.is_serverless:
            if content is None:
                raise AppError("OCR 입력 오류", "OCR 처리할 파일을 읽지 못했습니다.", 422)
            return DirectHttpTransport().process(filename, content)
        if source_url_factory is None:
            raise AppError("OCR 입력 오류", "OCR 처리할 파일을 준비하지 못했습니다.", 503)
        return RunpodServerlessTransport().process(
            filename,
            source_url_factory=source_url_factory,
            external_job_id=external_job_id,
            on_submitted=on_submitted,
            on_status=on_status,
        )