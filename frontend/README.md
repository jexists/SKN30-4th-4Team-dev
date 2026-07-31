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

## 환경변수

`.env.example` 을 `.env` 로 복사해 채웁니다. 읽는 곳은 [`src/config/env.ts`](src/config/env.ts) 한 곳뿐입니다.

| 키                       | 설명                                                          |
| ------------------------ | ------------------------------------------------------------- |
| `VITE_API_BASE_URL`      | 백엔드 주소. **비우는 게 기본** — 아래 참고                   |
| `VITE_SUPABASE_URL`      | Supabase Project URL (대시보드 → Settings → API)              |
| `VITE_SUPABASE_ANON_KEY` | anon public 키. 공개키라 프론트 노출 OK                       |
| `VITE_KAKAO_MAP_JS_KEY`  | 카카오맵 **JavaScript 키**. 선택 — 비우면 지도 대신 대체 화면 |

- **`VITE_API_BASE_URL` 은 비워두세요.** 비면 상대경로(`/api/...`)로 요청하고 vite 프록시가 `:8000` 으로 넘겨줍니다 — 같은 오리진이라 CORS 가 발생하지 않습니다. 값을 넣으면 브라우저가 그 주소를 직접 호출하므로 백엔드 `CORS_ORIGINS` 에 오리진을 추가해야 합니다.
- **Supabase 값 둘 중 하나라도 비면 인증이 통째로 꺼집니다.** 로그인·회원가입 화면이 "설정 필요" 안내로 바뀌고, 토큰이 없으니 보호 엔드포인트는 401, 채팅 기록도 저장되지 않습니다 (앱 자체는 그대로 동작).
- **`VITE_SUPABASE_URL` 은 백엔드 `.env` 의 `SUPABASE_URL` 과 같은 값이어야 합니다.** 백엔드가 그 주소의 JWKS 로 토큰을 검증하므로, 어긋나면 로그인은 되는데 API 호출만 401 이 나는 증상이 됩니다.
- **service role 키(백엔드 `SUPABASE_KEY`)를 여기에 넣지 마세요.** RLS 를 우회하는 키입니다. `VITE_` 접두사가 붙은 값은 빌드 시 번들에 그대로 박혀 공개됩니다.
- **`VITE_KAKAO_MAP_JS_KEY` 는 없어도 됩니다.** 비우면 위험 보고서의 위치 카드가 지도 대신 핀 대체 화면으로 뜨고 **주소 텍스트는 그대로 보입니다** — SDK 를 아예 요청하지 않으므로 콘솔 오류도 없습니다. 키는 카카오 개발자센터 → 내 애플리케이션 → 앱 키의 **JavaScript 키**입니다(REST API 키가 아닙니다).
  - ⚠️ **플랫폼 → Web 에 `http://localhost:5173` 과 운영 도메인을 등록해야 동작합니다.** 미등록이면 키가 맞아도 SDK 가 로드되지 않습니다 — 키를 넣었는데 지도가 안 보이면 코드보다 이걸 먼저 확인하세요(진단은 지도 루트 엘리먼트의 `data-state="failed"`).
- 서비스 이름 같은 환경 무관 상수는 `.env` 가 아니라 `config/env.ts` 의 `BRAND` 에서 관리합니다.

프로덕션 빌드(도커)에서는 `VITE_` 값이 **빌드 타임에 번들로 굳습니다.** 런타임 `environment:` 로는 바뀌지 않으니 `docker compose` 의 `build.args` 로 넘겨야 합니다 ([`Dockerfile`](Dockerfile) 참고). 또한 [`nginx.conf`](nginx.conf) 에는 `/api` 프록시가 없어서, 도커로 띄울 때는 `VITE_API_BASE_URL` 을 백엔드 공개 주소로 지정해야 합니다.

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
├── App.tsx           # 공통 레이아웃 (SiteHeader + <Outlet/> + 하단 HealthStatus)
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
