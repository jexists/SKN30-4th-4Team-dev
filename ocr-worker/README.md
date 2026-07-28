# Contract OCR/Masking Worker

사용자 계약서를 외부 OCR API로 전송하지 않고 로컬의
`PaddlePaddle/PaddleOCR-VL-1.6`으로 처리하기 위한 독립 worker입니다.

## 현재 범위

- PaddleOCR-VL 전체 파이프라인 지연 로딩
- 페이지별 Spotting 호출
- 주민등록번호·전화번호·이메일·계좌번호 규칙 탐지
- 문맥 라벨이 있는 이름·주소 탐지
- 픽셀 기반 마스킹 및 평탄화 PDF 생성
- LLM 전달용 텍스트의 개인정보 플레이스홀더 치환
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

모델은 첫 처리 요청에서 한 번만 로딩됩니다. `/health` 호출은 모델을 로드하지
않습니다.

로컬 CPU 시연에서는 `.env`의 `OCR_PROVIDER=tesseract`로 빠른 한국어 OCR을 사용할
수 있습니다(`tesseract`와 `kor` 언어팩 필요). `OCR_PROVIDER=paddle_vl`은 기존
PaddleOCR-VL 모델을 사용하지만 Apple Silicon CPU에서는 페이지 처리에 수분이 걸릴
수 있습니다. 두 경로 모두 같은 개인정보 탐지·마스킹·재검증 파이프라인을 거칩니다.

## API

- `POST /v1/process`: 기존 방식. 마스킹된 PDF를 바로 반환합니다.
- `POST /v1/process-for-analysis`: 마스킹 PDF(base64), 개인정보 치환 텍스트,
  마스킹 건수와 검토 필요 여부를 JSON으로 반환합니다.

두 처리 API 모두 같은 OCR 결과로 PDF와 텍스트를 만들므로 OCR을 중복 실행하지
않습니다. 분석용 텍스트는 탐지된 값을 `[이름]`, `[주소]`, `[전화번호]` 같은
플레이스홀더로 치환한 뒤 다시 검사합니다. 지원하는 개인정보 패턴이 남아 있으면
응답하지 않고 422로 중단합니다.

이름과 주소 탐지는 현재 `임대인:`, `임차인:`, `성명:`, `주소:` 같은 문맥 라벨을
사용합니다. 모든 자유 형식 개인정보를 보장하는 NER 모델은 아니므로
`review_required`가 참인 문서는 사람이 최종 확인해야 합니다.
