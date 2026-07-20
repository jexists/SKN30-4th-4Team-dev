# frontend — React + Vite + TypeScript

전·월세 분쟁 팩트체커 프론트엔드. 상세 규칙은 [`CLAUDE.md`](./CLAUDE.md), 첫 설정·실행은 [`../docs/setup.md`](../docs/setup.md) 참고.

## 첫 설정

```bash
npm install
cp .env.example .env          # Windows(PowerShell): Copy-Item .env.example .env
```

## 실행

```bash
npm run dev
# → http://localhost:5173   (백엔드가 8000 에서 떠 있어야 연결 표시가 초록불)
```

## 스크립트

```bash
npm run build        # 타입체크 + 프로덕션 빌드
npm run lint         # ESLint
npm run format       # Prettier
npm run test         # Vitest (단발)
npm run test:watch   # Vitest (TDD 워치)
```

## 구조

```
src/
├── main.tsx          # 진입점 (RouterProvider + 전역 SCSS)
├── App.tsx           # 공통 레이아웃 (NavBar + <Outlet/> + 하단 HealthStatus)
├── routes.tsx        # URL ↔ 페이지 매핑
├── pages/            # 화면별 스텁 (지금은 이름 텍스트만)
├── components/       # 재사용 컴포넌트 (컴포넌트별 폴더, PascalCase)
├── hooks/            # 커스텀 훅 (useHealth)
├── api/              # 백엔드 호출 래퍼 (client.ts — 표준 봉투 언래핑)
├── types/            # 공용 타입 (ApiResponse 등)
├── styles/           # 전역 SCSS (main.scss, _variables.scss)
└── test/             # Vitest 셋업
```

- **명명**: 컴포넌트·페이지·폴더는 PascalCase, 훅·유틸은 camelCase.
- **스타일**: 컴포넌트별 `*.module.scss` (co-location), 전역은 `styles/`.
- **API**: `client.ts` 가 표준 응답 봉투를 벗겨 `data` 반환, 실패는 `ApiError` throw.
