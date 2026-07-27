# Contract OCR/Masking Worker

사용자 계약서를 외부 OCR API로 전송하지 않고 로컬의
`PaddlePaddle/PaddleOCR-VL-1.6`으로 처리하기 위한 독립 worker입니다.

## 현재 범위

- PaddleOCR-VL 전체 파이프라인 지연 로딩
- 페이지별 Spotting 호출
- PDF 텍스트층 우선 추출, 텍스트가 없는 페이지만 OCR 처리
- 임대차계약서·특약사항·확인설명서·공제증서 자동 분류 및 구조화 추출
- 금액·날짜·호수·면적·등록번호 정규화와 원문·좌표·신뢰도 보존
- 주민등록번호·전화번호·이메일·계좌번호 규칙 탐지
- 픽셀 기반 마스킹 및 평탄화 PDF 생성
- 마스킹 결과 재-OCR 검증
- 입력/중간 파일은 요청별 임시 디렉터리에만 저장

Spotting의 글자·단어별 좌표 스키마는 실제 v1.6 한국어 계약서 PoC로 확정해야
합니다. 현재는 개인정보가 포함된 블록 전체를 가리고 결과를
`X-Review-Required: true`로 표시하는 보수적 fallback을 사용합니다.

## 모델 준비

모델 파일은 Git에 커밋하지 않습니다. Hugging Face snapshot을 `/models` 아래에
미리 준비하고 `.env`의 `OCR_VL_MODEL_DIR`에 지정합니다. 전체 파이프라인의
레이아웃·방향·왜곡 보정 모델도 완전 오프라인 운영에서는 각각 로컬 경로를
설정해야 합니다.

## 실행

```bash
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --port 8100
```

모델은 OCR 또는 마스킹 재검증이 필요한 첫 `/v1/process` 또는 `/v1/extract` 요청에서
한 번만 로딩됩니다. 구조화 필드 추출은 PDF 텍스트층을 우선 사용하고, 스캔 페이지만
OCR로 전환합니다. `/health` 호출은 모델을 로드하지 않습니다.

## API

- `POST /v1/extract`, `mode=contract_bundle`: 4종 계약 문서를 분류해 Field 스키마로 반환
- `POST /v1/extract`, `mode=registry`: 등기부등본의 페이지별 OCR 원문 반환
- `POST /v1/process`: 기존 개인정보 마스킹 PDF 반환
- `GET /health`: 모델을 로드하지 않는 연결 확인

브라우저는 worker를 직접 호출하지 않습니다. `/analyze` → 백엔드
`/api/v1/documents/analyze` → worker `/v1/extract` 순서로 연결됩니다.
