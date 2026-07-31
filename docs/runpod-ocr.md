# RunPod Queue-based Serverless OCR 배포

## 왜 기존 Pod HTTP Proxy를 운영에 쓰지 않는가

기존 구조는 백엔드가 `https://<POD_ID>-8100.proxy.runpod.net`의 FastAPI OCR API를 한 번의
동기 HTTP 요청으로 호출했다. OCR이 100초를 넘으면 애플리케이션 timeout을 20분으로 늘려도
RunPod HTTP Proxy/Cloudflare가 연결을 먼저 끊어 `524`가 발생한다.

운영에서는 Queue-based Serverless Endpoint를 사용한다. 백엔드는 `/run`에 짧게 제출하고
받은 작업 ID를 DB에 저장한 뒤 `/status/{job_id}`를 짧은 요청으로 폴링한다. OCR 추론에
몇 분이 걸려도 장시간 유지되는 외부 HTTP 연결이 없으므로 524 경로 자체가 사라진다.
기존 FastAPI Pod와 `OCR_TRANSPORT=direct`는 로컬 개발 및 진단용으로만 유지한다.

## 1. DB 스키마 적용

Supabase SQL Editor 또는 프로젝트의 기존 DDL 적용 절차로 `backend/sql/schema.sql`을 실행한다.
추가되는 `analysis_external_job`은 `(analysis_job_id, file_index)`별 RunPod 작업 ID와 상태를
보관한다. 이 테이블이 없으면 백엔드 재시작 후 상태 조회를 재개할 수 없다.

## 2. Serverless 이미지 빌드와 푸시

Apple Silicon에서도 RunPod가 실행할 수 있도록 `linux/amd64`로 빌드한다. 운영에는 변경되지
않는 버전 태그나 digest를 사용하고 `latest`는 사용하지 않는다.

```bash
docker buildx build \
  --platform linux/amd64 \
  -f ocr-worker/Dockerfile.serverless \
  -t ghcr.io/<GITHUB_ID>/skn30-ocr-worker:serverless-v1 \
  --push \
  ocr-worker
```

private GHCR 이미지라면 RunPod Container Registry Credentials에 읽기 전용 토큰을 등록한다.
API 키나 `.env` 파일을 이미지에 COPY하지 않는다.

## 3. RunPod Dashboard 설정

RunPod Console의 **Serverless → New Endpoint → Import from Docker Registry**에서 위 이미지를
선택하고 다음과 같이 설정한다.

- Endpoint type: `Queue`
- GPU: `RTX 4090` 또는 `A40`
- Min workers: `1` (cold start를 피해야 하는 시연/운영 권장)
- Max workers: 초기 `1` (1B 모델 GPU 메모리 사용량을 확인한 뒤 확대)
- Execution timeout: `1200초`(20분)
- Job TTL: `3600초`(1시간)
- Worker concurrency: `1`
- Container disk: 모델과 의존성을 포함할 만큼 충분히 설정

RunPod worker 환경변수:

```env
OCR_PROVIDER=paddle_vl
OCR_MODEL_NAME=PaddlePaddle/PaddleOCR-VL-1.6
OCR_PIPELINE_VERSION=v1.6
OCR_ENGINE=transformers
OCR_DEVICE=gpu:0

OCR_USE_ORIENTATION=true
OCR_USE_LAYOUT_DETECTION=true
OCR_USE_UNWARPING=false
OCR_USE_SEAL_RECOGNITION=true
OCR_LAYOUT_SHAPE_MODE=poly
OCR_RENDER_DPI=250
OCR_MAX_FILE_MB=20
OCR_MAX_PAGES=20
OCR_MASK_MARGIN_PX=4

# SUPABASE_URL 전체가 아니라 hostname만 입력한다.
OCR_SOURCE_ALLOWED_HOST=<PROJECT_REF>.supabase.co
OCR_SOURCE_DOWNLOAD_TIMEOUT_SECONDS=30
```

Serverless worker에는 `SUPABASE_SERVICE_ROLE_KEY`, `RUNPOD_API_KEY`, 기존
`OCR_WORKER_API_KEY`를 넣지 않는다. 워커가 받는 것은 만료 시간이 짧은 객체별 signed URL뿐이다.

## 4. RunPod API 키와 백엔드 설정

RunPod Settings의 API Keys에서 Serverless endpoint 호출 권한이 있는 키를 생성한다. 키는
`backend/.env`에만 저장하고 Git에 커밋하지 않는다. 노출된 기존 키가 있다면 Dashboard에서
폐기한 뒤 새 키로 교체한다.

```env
OCR_TRANSPORT=runpod_serverless
RUNPOD_ENDPOINT_ID=<QUEUE_ENDPOINT_ID>
RUNPOD_API_KEY=<RUNPOD_API_KEY>
RUNPOD_STATUS_POLL_SECONDS=3
RUNPOD_EXECUTION_TIMEOUT_MS=1200000
RUNPOD_JOB_TTL_MS=3600000
RUNPOD_HTTP_TIMEOUT_SECONDS=15

ANALYSIS_SIGNED_URL_TTL_SECONDS=3600
ANALYSIS_INPUT_BUCKET=analysis-inputs
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<BACKEND_ONLY_SERVICE_ROLE_KEY>
```

`ANALYSIS_SIGNED_URL_TTL_SECONDS`는 `RUNPOD_JOB_TTL_MS / 1000`보다 짧으면 안 된다. 원본은
RunPod 작업이 진행되는 동안 private bucket에 유지되고 전체 분석 성공/최종 실패 뒤에만 기존
정책대로 삭제된다. 프론트엔드 환경변수와 API 계약은 바뀌지 않는다.

## 5. 배포 검증

백엔드를 재시작한 뒤 실제 분석을 한 건 제출한다. `POST /api/v1/analyses`는 기존처럼 즉시
`202`를 반환하고 프론트엔드는 기존 GET API를 폴링한다.

RunPod API를 직접 확인할 때는 다음처럼 `/run`을 호출한다. signed URL은 로그나 셸 기록에
남기지 말고 테스트 직후 폐기한다.

```bash
curl -sS \
  -X POST \
  -H "Authorization: Bearer <RUNPOD_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "source_url": "<SHORT_LIVED_SIGNED_URL>",
      "filename": "contract.png",
      "content_type": "image/png"
    },
    "policy": {"executionTimeout": 1200000, "ttl": 3600000}
  }' \
  "https://api.runpod.ai/v2/<QUEUE_ENDPOINT_ID>/run"
```

응답의 `id`로 상태를 확인한다.

```bash
curl -sS \
  -H "Authorization: Bearer <RUNPOD_API_KEY>" \
  "https://api.runpod.ai/v2/<QUEUE_ENDPOINT_ID>/status/<RUNPOD_JOB_ID>"
```

정상 흐름은 `IN_QUEUE → IN_PROGRESS → COMPLETED`이며 `COMPLETED.output`은 기존
`AnalysisReadyResponse` JSON과 같아야 한다. 백엔드 DB에서는 다음을 확인한다.

```sql
SELECT analysis_job_id, file_index, external_job_id, external_status,
       submitted_at, updated_at
FROM analysis_external_job
ORDER BY submitted_at DESC
LIMIT 20;
```

## 6. 장애 분류와 복구

- `IN_QUEUE`, `IN_PROGRESS`, `RUNNING`: 같은 작업 ID를 계속 조회한다.
- `FAILED`: RunPod 실행 실패로 분류한다.
- `TIMED_OUT`: 504 성격의 실행 시간 초과로 분류한다.
- `CANCELLED`: 취소된 작업으로 분류한다.
- RunPod API `429`, 일시적 `5xx`: 짧은 요청만 지수 백오프로 재시도한다.
- 백엔드 전체 대기 제한 도달: 가능하면 `/cancel/{job_id}`를 호출한다.
- 백엔드 재시작/lease 복구: 파일별 DB 행의 `external_job_id`가 있으면 `/run`을 다시 호출하지
  않고 `/status`부터 재개한다.

워커의 안전한 오류 코드는 `INVALID_IMAGE`, `UNSUPPORTED_FORMAT`, `FILE_TOO_LARGE`,
`OCR_RESULT_INVALID`, `PII_REMAINS`, `OCR_INTERNAL_ERROR`다. 로그에는 signed URL, API 키,
원본 파일명, OCR 원문을 남기지 않는다.

## 7. 로컬 direct 모드

기존 FastAPI worker를 개발용으로 실행할 때만 다음 설정을 쓴다.

```env
OCR_TRANSPORT=direct
OCR_WORKER_URL=http://127.0.0.1:8100
OCR_WORKER_API_KEY=
OCR_WORKER_PROCESS_TIMEOUT_SECONDS=1200
```

이 모드는 RunPod Pod HTTP Proxy의 100초 제한을 해결하지 않으므로 운영 OCR에는 사용하지 않는다.
