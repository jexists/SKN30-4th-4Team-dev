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
