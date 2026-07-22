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
- **기본 UI 컴포넌트(Button/Input)는 미리 만들지 않는다** — 실제 화면에서 반복이 생기면(rule of three) 추가.
- 디자인 토큰은 `styles/_variables.scss` 에서 관리하고 `@use` 로 참조.

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
