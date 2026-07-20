# 팀 규칙 (Conventions)

정한 규칙과 아직 결정하지 못한 항목을 한곳에 모읍니다.

## ✅ 정한 것

### API
- **응답 봉투(표준)**: 모든 엔드포인트는 `ApiResponse` 로 응답.
  ```json
  { "success": true, "code": 200, "message": "OK", "data": { }, "error": null }
  { "success": false, "code": 400, "message": "...", "data": null, "error": { "title": "", "message": "" } }
  ```
- **에러 코드 체계**: `error.title` 을 코드성 식별자로(예: `VALIDATION_ERROR`, `HTTP_ERROR`, `INTERNAL_ERROR`). 백엔드 `core/exceptions.py` 가 예외를 봉투로 자동 변환.
- **API URL 규칙**: 모든 경로 `/api/v1` prefix. 리소스는 소문자·복수형 권장.

### 데이터
- **DB 네이밍**: 테이블·컬럼 `snake_case` **단수**. (모델 클래스는 `PascalCase`) 예약어 `user` 는 `app_user`. — API 경로는 REST 관례상 복수(`/users`).
- **날짜/시간 형식**: 저장·전송 모두 **UTC ISO 8601** (`2026-07-21T00:00:00Z`), DB 는 `TIMESTAMPTZ`. 표시 시점에 로컬 변환.
- **PK·공통 컬럼**: PK 는 `UUID`(`gen_random_uuid()`). 공통 컬럼 `created_at`·`updated_at`, 사용자가 삭제하는 엔티티엔 `deleted_at`(soft delete).
- **인증 테이블**: 로그인·이메일·소셜 정보는 Supabase `auth.users` 관리. 앱은 `app_user.id = auth.users(id)` 확장 테이블만 둠.
- **파일 업로드**: 저장 위치 = **Supabase Storage** (경로만 DB 에 `storage_path` 로 보관).
- **출처 인용(citation)**: 답변 근거는 `message_source` 테이블에 저장(메시지↔청크 + 유사도). *표기(UI) 형식은 추후 확정.*
- 상세 스키마는 [ERD.md](./ERD.md) 참고.

### 코드
- **폴더 구조**: Layer 기반(백엔드 api/core/db/models/schemas/services), Feature 폴더(프론트 pages/components).
- **코드 품질**: 백엔드 `ruff`, 프론트 `ESLint`+`Prettier`.
- **테스트/TDD**: 백엔드 `pytest`, 프론트 `Vitest`. TDD(red→green→refactor) **권장**(강제 아님).
- **커밋**: 한국어 Conventional Commits (`feat/fix/refactor/chore/docs/test/style/perf`).
- **브랜치**: feature → `develop` → `main`.

### AI 응답 규칙
- _작성 예정_ — 답변 톤/길이, 근거 인용 방식, 모르면 모른다고 하기 등

## 🔲 결정 필요 (합의되면 위로 옮기기)
- **페이지네이션**: 목록 응답 형식(`page`/`size` + `total` vs 커서), 봉투 `data` 안 구조
- **파일 업로드 제한**: 최대 크기·허용 타입 (저장 위치는 Supabase Storage 로 확정)
- **인증 역할**: `user`/`admin` 등 역할 모델, 보호 라우트 규칙
- **금액/숫자**: 보증금 등은 `Decimal`(float 금지) — 정밀도 규칙
- **출처 인용(citation) 표기**: 저장은 `message_source` 로 확정 — 화면 표기·반환 형식만 미정
- **면책 고지(disclaimer)**: "법률 자문 아님" 문구·노출 위치
- **프롬프트 관리**: `prompts/` 위치·버전 관리
- **AI 관찰성**: LangSmith 등 추적 도입 여부
