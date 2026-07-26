# 계약서 OCR·개인정보 마스킹

## 책임 경계

- `backend/`: 인증, 업로드 검증, 작업 상태, private storage 연결
- `ocr-worker/`: 로컬 PaddleOCR-VL 추론, 개인정보 탐지, 영구 마스킹, 재검증
- `data/`: 공공 법률/RAG 데이터 전용. 사용자 계약서를 저장하지 않음

## 모델

- Hugging Face: `PaddlePaddle/PaddleOCR-VL-1.6`
- 실행: 공식 `PaddleOCRVL`, `pipeline_version="v1.6"`
- 문서 파싱: 전체 layout + VLM 파이프라인
- 마스킹 좌표: 페이지별 `prompt_label="spotting"`
- 도장: `use_seal_recognition=True`

## 적용 순서

1. 합성 한국어 계약서로 v1.6 Spotting JSON 좌표 포맷을 확정한다.
2. `spotting_parser.py`에 글자/단어 좌표 파서를 추가한다.
3. 이름·주소 등 팀 마스킹 정책을 `policy.py`에 확정한다.
4. Supabase private Storage와 비동기 작업 상태를 백엔드에 연결한다.
5. 마스킹 전후 개인정보 재현율과 처리시간을 측정한다.

## 완료 기준

- 주민등록번호·전화번호·계좌번호 테스트셋 재현율을 별도로 보고한다.
- 마스킹 PDF에서 원본 텍스트 레이어와 메타데이터가 남지 않는다.
- 처리 완료 후 임시 원본과 페이지 이미지를 삭제한다.
- OCR 원문과 개인정보를 애플리케이션 로그에 기록하지 않는다.
- 좌표/출력 파싱이 불확실하면 자동 완료하지 않고 `REVIEW_REQUIRED`로 보낸다.
