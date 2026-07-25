# 프론트엔드 작업 규칙 (React + Vite + TypeScript)

> 이 파일은 `frontend/` 작업 시 자동 로드됩니다. 공통 규칙은 루트 `CLAUDE.md` 참고.

## 스택

- React 19 · Vite · TypeScript · react-router-dom
- 스타일: **SCSS + CSS Modules** (`*.module.scss`)
- 테스트: **Vitest + React Testing Library** / 린트·포맷: ESLint + Prettier

## 명명·배치 규칙

- 컴포넌트·페이지와 그 **폴더는 PascalCase** (`HealthStatus/HealthStatus.tsx`).
- 훅·유틸·api 는 **camelCase** (`useHealth.ts`, `client.ts`), 훅은 `use`로 시작.
- **컴포넌트별 폴더 패턴**: 컴포넌트/페이지 하나 = 폴더 하나, 안에 `.tsx`(코드) + (스타일 생기면) `.module.scss` co-location. 테스트는 옆에 `*.test.tsx`.

## 폴더 역할

- `pages/` — 화면 단위 (라우트에 연결). 지금은 이름 텍스트만 있는 **스텁**.
- `components/` — 재사용 컴포넌트 (현재 `SiteHeader`·`SiteFooter`·`HealthStatus`·`icons`).
- `hooks/` — 커스텀 훅. `api/` — 백엔드 호출 래퍼. `types/` — 공용 타입. `styles/` — 전역 SCSS·토큰.
- `config/` — 앱 전역 설정. **`import.meta.env` 는 `config/env.ts` 에서만 읽고**, 서비스명은 `BRAND` 를 쓰고 하드코딩하지 않는다.
- `routes.tsx` — URL ↔ 페이지 매핑. `App.tsx` — 공통 레이아웃.

## 핵심 규칙

- **API 호출은 `api/client.ts` 를 통해서**. client 가 표준 응답 봉투(`ApiResponse<T>`)를 벗겨 `data` 반환, 실패는 `ApiError` throw → 화면 코드는 봉투를 몰라도 됨.
- 백엔드 경로는 **`/api/v1`** (dev 는 vite 프록시가 `/api` → :8000 전달).

### API 에러 처리 (화면에서 직접 하지 않는다)

`client.ts` 가 **모든 호출의 공통 통로**다. 봉투를 해석해 토스트·오류 모달까지 여기서 띄우므로, 새 화면·새 API 를 추가해도 같은 동작을 그냥 얻는다.

- 봉투 `message` → **토스트**(`components/Toast`), `error.title`/`error.message` → **공통 오류 모달**(`components/ErrorModal`). 판정은 `api/apiErrorHandler.ts` 한 곳에서 한다.
- **화면은 상태 코드별 문구를 갖지 않는다.** `catch` 에서는 로딩을 끄고 "실패했다"만 기록한 뒤, 그 자리에 **공통 `<ErrorState />`**(`components/ErrorState`)를 그린다. 재시도 버튼을 보일지는 `isRetryable(error)` 이 정한다(404·403 은 안 보임).
- **API 실패를 Empty State 로 그리지 않는다.** "대화가 없습니다" 는 `success: true` 인데 데이터가 0건일 때만 쓴다. 실패했는데 빈 목록을 그리면 서버 장애가 "데이터 없음"으로 보인다.
- **화면에서 `showError(...)` 를 직접 부르지 않는다.** 성공 토스트 문구도 서버 `message` 가 소유하므로 `showToast(...)` 를 중복해서 심지 않는다(로그인 폼 검증처럼 API 와 무관한 클라이언트 알림은 예외).
- **401 은 아무것도 띄우지 않는다.** `client.ts` 가 토큰 갱신 1회 → 실패 시 로그아웃·로그인 화면 이동까지 처리한다.
- 화면이 실패를 직접 표현해야 하는 소수 예외(`sendChat` 의 오류 말풍선, health 폴링)만 `{ silent: true }` 로 공통 처리를 끈다.
- 디자인 토큰은 `styles/_variables.scss` 에서, 타이포 믹스인은 `styles/_typography.scss` 에서 관리하고 `@use` 로 참조.

## 디자인 시스템 (필수)

**새 페이지·컴포넌트를 만들거나 수정할 때 반드시 [`../design.md`](../design.md) 를 먼저 읽는다.**

- **페이지 배경은 반드시 `v.$page-bg` (#f2f4fb)**. 다른 색을 새 페이지에 쓰지 않는다.
- **색상은 토큰만.** 임의 `#xxx` 하드코딩 금지. 부족하면 `_variables.scss` 에 먼저 추가하고 `design.md` 를 동기화한다.
- **Typography 는 `_typography.scss` 믹스인만** 사용 (`@include t.body;` 등). `font-size: 14.5px` 같은 반쪽 값을 새로 만들지 않는다.
- **Spacing 은 `$space-*` 4pt 스케일만.** 임의의 `padding: 13px` 같은 값 금지.
- **radius/shadow/z-index/transition/breakpoint 도 토큰만** 사용한다.
- **공통 컴포넌트 우선**: Button/Input/Card/Modal/Toast/Badge 등 새로 만들기 전에 `components/*` 를 확인한다. 같은 스타일 블록이 rule of three (3번째 반복) 를 넘기면 페이지 로컬 CSS 로 두지 말고 `components/` 로 추출한다. 추출 후 `design.md` §16 인벤토리에 등록.
- **인라인 스타일 금지**. 항상 CSS Modules (`*.module.scss`) 를 통한 클래스 사용.
- **디자인 시스템이 바뀌면 `design.md` 도 함께 업데이트.**

## 명령

```bash
npm run dev            # 개발 서버 (http://localhost:5173)
npm run build          # 타입체크 + 빌드
npm run test           # Vitest (TDD 권장: red→green→refactor)
npm run lint           # ESLint
npm run format         # Prettier
```

## 화면(사이트맵) — 현재 스텁

`/`, `/analyze`(+`/analyze/:id`), `/chat`(+`/chat/:id`), `/login`, `/onboarding`, `/mypage`, `/terms`, `/privacy`
화면 추가: `pages/` 에 폴더 만들고 `routes.tsx` 에 등록.
