# RunPod에서 PaddleOCR-VL 1.6 Worker 실행

첫 검증 단계에서는 프론트엔드와 백엔드는 로컬에서 실행하고, OCR Worker만 RunPod
Secure Cloud Pod에서 실행한다. 로컬의 MLX-VLM 서버와 OCR Worker는 실행하지 않는다.

```text
localhost:5173 frontend
        -> localhost:8000 backend
        -> https://<POD_ID>-8100.proxy.runpod.net
        -> PaddleOCR-VL 1.6 (RunPod GPU)
```

## 1. API 키 생성

```bash
openssl rand -hex 32
```

출력값은 Git에 저장하지 않고 RunPod과 `backend/.env`에 같은 값으로 등록한다.

## 2. linux/amd64 이미지 빌드 및 푸시

Docker Desktop을 먼저 실행한다. Apple Silicon 맥에서 RunPod용 이미지를 만들 때는
`--platform linux/amd64`가 필요하다.

```bash
docker buildx build \
  --platform linux/amd64 \
  -f ocr-worker/Dockerfile.runpod \
  -t ghcr.io/<GITHUB_ID>/skn30-ocr-worker:paddle-vl-1.6 \
  --push \
  ocr-worker
```

GHCR 패키지가 private이면 RunPod의 Container Registry Credentials에 읽기 권한이 있는
GitHub 토큰을 등록한다. 토큰과 `.env`는 이미지에 포함하지 않는다.

## 3. RunPod Pod 설정

- Cloud: Secure Cloud
- GPU: RTX 4090 또는 A40
- Container Image: 위에서 푸시한 이미지
- Expose HTTP Ports: `8100`
- Container/Network Volume: 최소 30GB
- Volume mount: `/workspace`

환경변수:

```env
OCR_PROVIDER=paddle_vl
OCR_MODEL_NAME=PaddlePaddle/PaddleOCR-VL-1.6
OCR_PIPELINE_VERSION=v1.6
OCR_ENGINE=transformers
OCR_DEVICE=gpu:0

OCR_VL_BACKEND=
OCR_VL_SERVER_URL=
OCR_VL_API_MODEL_NAME=

OCR_USE_ORIENTATION=true
OCR_USE_UNWARPING=false
OCR_USE_SEAL_RECOGNITION=true
OCR_LAYOUT_SHAPE_MODE=poly
OCR_RENDER_DPI=250
OCR_MAX_FILE_MB=20
OCR_MAX_PAGES=20
OCR_MASK_MARGIN_PX=4

OCR_WORKER_API_KEY=<1단계에서 생성한 값>
```

첫 요청에서는 모델을 `/workspace` 아래 캐시에 내려받고 로딩하므로 오래 걸릴 수 있다.
Pod를 재생성해도 캐시를 재사용하려면 Network Volume을 유지한다.

## 4. 인증과 OCR 확인

RunPod URL은 `https://<POD_ID>-8100.proxy.runpod.net` 형식이다.

키 없이 호출하면 `401`이어야 한다.

```bash
curl -i https://<POD_ID>-8100.proxy.runpod.net/health
```

키를 넣으면 `200`이어야 한다.

```bash
curl -i \
  -H "X-API-Key: <OCR_WORKER_API_KEY>" \
  https://<POD_ID>-8100.proxy.runpod.net/health
```

샘플 처리:

```bash
curl \
  -o /tmp/runpod-contract.json \
  -w "\nHTTP %{http_code}, %{time_total}초\n" \
  -X POST \
  -H "X-API-Key: <OCR_WORKER_API_KEY>" \
  -F "file=@ocr-worker/samples/계약서.png" \
  https://<POD_ID>-8100.proxy.runpod.net/v1/process-for-analysis
```

```bash
jq '{text_safe_for_analysis, mask_count, redaction_counts, review_required}' \
  /tmp/runpod-contract.json
```

## 5. 로컬 백엔드 연결

`backend/.env`:

```env
OCR_WORKER_URL=https://<POD_ID>-8100.proxy.runpod.net
OCR_WORKER_API_KEY=<RunPod과 같은 값>
```

백엔드를 재시작한 뒤 연결을 확인한다.

```bash
curl http://127.0.0.1:8000/api/v1/documents/ocr-health
```

이후 프론트엔드에서 문서 3개를 제출한다. RunPod HTTP 프록시는 요청당 100초 제한이
있으므로 개별 문서가 이를 넘으면 비동기 작업 API 또는 Serverless 작업 방식으로 전환해야 한다.

## 6. 종료 후 원상복구

RunPod을 끈 상태에서 현재 백엔드는 자동 폴백하지 않고 `503`을 반환한다. 로컬 Worker로
되돌리려면 `backend/.env`를 변경하고 백엔드를 재시작한다.

```env
OCR_WORKER_URL=http://127.0.0.1:8100
OCR_WORKER_API_KEY=
```

CPU PaddleOCR 자동 폴백은 별도 단계에서 primary/fallback Worker 라우팅으로 구현한다.
