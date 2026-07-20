# /start — 새 작업 시작

사용자가 전달한 작업 개요를 바탕으로 브랜치를 만들고 작업 준비를 한다.

인자: $ARGUMENTS

---

## 작업 시작 전: 기획 모호도 게이트 (필수, 최우선)

브랜치 생성·코드 탐색을 시작하기 전에 전달받은 기획 설명의 **모호도를 먼저 평가**한다.

- **모호도 0.2 미만**일 때만 아래 "절차"로 진입해 작업을 시작한다.
- **모호도 0.2 이상**이거나 설명이 부족·불명확하면, 추측으로 채워넣지 말고 즉시 사용자에게 질문한다.
- 모호도가 0.2 미만으로 떨어질 때까지 질문을 반복한다.
- 질문은 한 번에 핵심만 모아서 던지고, 답을 받으면 다시 모호도를 평가한다.

**모호도 평가 기준 (하나라도 불명확하면 모호도 높음):**
- 변경 대상 기능/레이어가 특정되는가 (backend / frontend / 데이터 / 문서)
- 기대 동작·결과가 명확한가
- 데이터 흐름 상 어느 단계에 해당하는가 (오프라인 색인 파이프라인 vs 런타임 API)
- 엣지 케이스·범위가 합의됐는가

**핵심: 추측 금지, 즉시 질문, 모호도 0.2 미만 확보 후 시작.**

---

## 절차

### 1. 최신 develop 가져오기

```bash
git fetch origin develop
```

### 2. 새 브랜치 생성

```bash
git checkout -b <prefix>/<브랜치명> origin/develop
```

> 항상 원격 최신 develop을 받아 그 위에 분기한다(`fetch` 후 `origin/develop` 기준).
> 로컬 develop에 merge하지 않으므로 충돌이 발생하지 않는다.

**prefix** — 작업 성격에 맞게 선택 (Conventional Commits 기준):

| prefix | 용도 |
|--------|------|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `refactor` | 동작 변경 없는 코드 개선 |
| `chore` | 빌드/설정/의존성 |
| `docs` | 문서 |
| `test` | 테스트 추가·수정 |

**브랜치명** — 작업 개요를 영문 kebab-case로 요약:
```
feat/analyze-upload-api
fix/health-db-check
refactor/response-envelope
docs/update-erd
```

브랜치명이 애매하면 사용자에게 확인.

### 3. 브랜치 생성 완료 보고

사용자에게 다음을 보고:
- 생성된 브랜치명
- 기준 커밋 (develop HEAD)

### 4. 코드 탐색 및 작업 계획 수립

작업 개요를 바탕으로 관련 코드를 탐색하고 작업 계획을 수립한다.
(해당 폴더 작업 시 `backend/CLAUDE.md` · `frontend/CLAUDE.md` 가 자동 로드된다.)

관련 영역을 먼저 파악한다:
- `backend/app/` — FastAPI 핵심 로직 (api·core·db·models·schemas·services)
- `backend/pipeline/` — 오프라인 색인 배치 (data → Supabase)
- `frontend/src/` — React UI (pages·components·hooks·api)
- `data/` — 수집·전처리 데이터 단계
- `docs/` — 기획(PRD)·아키텍처·ERD·규칙 문서
