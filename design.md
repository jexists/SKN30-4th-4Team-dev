# Design System — HomeShield

> 이 문서는 프로젝트가 실제로 사용 중인 디자인 규칙의 단일 소스입니다.
> 새 페이지·컴포넌트를 만들 때 반드시 이 문서와 [`frontend/src/styles/_variables.scss`](frontend/src/styles/_variables.scss) 를 먼저 확인하세요.
> **임의의 색·폰트·간격을 새로 만들지 마세요.** 부족하면 이 문서와 토큰 파일에 먼저 추가한 뒤 사용합니다.

---

## 0. 디자인 원칙

1. **단일 소스**: 모든 시각 토큰은 `_variables.scss` 에, 반복 텍스트 스타일은 `_typography.scss` 에 있다. 하드코딩 대신 토큰을 참조한다.
2. **일관성 > 개성**: 페이지마다 새 스타일을 만들지 않고, 기존 규칙 조합으로 표현한다.
3. **차분한 무드**: 네이비-슬레이트 뉴트럴을 기본으로, 시맨틱(green/red/amber/orange) 은 신호로만 사용한다.
4. **모바일 우선**: `max-width` 미디어 쿼리로 축소하고, 지정된 브레이크포인트만 사용한다.
5. **접근성 기본**: 텍스트 콘트라스트, `prefers-reduced-motion`, 폼 라벨을 항상 지킨다.

---

## 1. Color Palette

토큰은 `_variables.scss` 에 정의되어 있고, `@use '../../styles/variables' as v;` 후 `v.$name` 으로 참조합니다.

### 브랜드 · 뉴트럴

| 토큰 | 값 | 용도 |
|---|---|---|
| `$white` | `#fff` | 배경 |
| `$navy-900` | `#0f1a35` | 다크 밴드·푸터 배경, 봇 아바타 |
| `$navy-800` | `#17224a` | 기본 버튼·강조 제목 |
| `$navy-700` | `#263258` | 다크 위 카드 테두리 |
| `$navy-hover` | `#101a3c` | 네이비 버튼 hover |
| `$ink` | `#1b2440` | 밝은 배경 위 본문·제목 |
| `$slate` | `#5b6478` | 본문·보조 텍스트 |
| `$slate-light` | `#8b93a7` | 다크 위 보조 텍스트 |
| `$text-placeholder` | `#a7aec0` | 입력 placeholder |
| `$text-on-dark` | `#fff` | 다크 배경 위 텍스트 |
| `$text-on-dark-muted` | `#c3cbe2` | 다크 배경 위 보조 텍스트 |

### 배경 (Surface)

| 토큰 | 값 | 용도 |
|---|---|---|
| `$page-bg` | `#f2f4fb` | **모든 페이지의 배경 (공통)** |
| `$surface` | `#fff` | 카드·모달·헤더 등 표면 |
| `$surface-raised` | `#fcfdff` | 입력 필드 (살짝 들뜬 표면) |
| `$surface-sunken` | `#fbfcfe` | 드롭존 (살짝 가라앉은 표면) |
| `$backdrop` | `rgba(15,23,42,0.48)` | 모달 오버레이 |
| `$footer-compact-bg` | `#f6f7fa` | compact 푸터 스트립 전용 (본문과 살짝 오프셋된 마감 띠). 페이지 배경으로 사용 금지 |

**규칙: 페이지 배경은 반드시 `$page-bg` 만 사용합니다.**  단, 로그인/회원가입처럼 카드 뒤 배경에 부드러운 그라디언트를 쓰는 경우는 `linear-gradient(180deg, #f8f9ff, v.$page-bg)` 로 시작·끝을 `$page-bg` 에 맞춥니다.

### 보더

| 토큰 | 값 | 용도 |
|---|---|---|
| `$border-subtle` | `#eef0f4` | 섹션 구분선 |
| `$border-default` | `#e8ebf1` | 카드 기본 테두리 |
| `$border-card` | `#e6e9f2` | 카드 대체 테두리 |
| `$border-strong` | `#dfe3ec` | 강조 테두리·입력 필드 |

### 액센트 배경

| 토큰 | 값 | 용도 |
|---|---|---|
| `$lavender` | `#e9edf9` | CTA 배경, 브랜드 배지 |
| `$pill` | `#eef1f8` | pill·아이콘 배경 |
| `$blue-soft` | `#eef3fb` | 정보 배경 (chat 봇 말풍선 등) |

### 시맨틱 (신호로만 사용)

| 토큰 | 값 | 용도 |
|---|---|---|
| `$green` / `$green-soft` | `#16a34a` / `#e8f5ec` | 성공·안전 |
| `$red` / `$red-hover` / `$red-soft` | `#dc2626` / `#b91c1c` / `#fdecec` | 에러·위험 (`$red-hover` 는 Danger 버튼 hover) |
| `$amber` / `$amber-soft` | `#f59e0b` / `#fef3e0` | 경고·주의 |
| `$orange` / `$orange-soft` | `#ea580c` / `#fdece1` | 위험 리포트 강조 |

### 브랜드 소셜

| 토큰 | 값 | 용도 |
|---|---|---|
| `$brand-kakao` / `$brand-kakao-text` | `#fee500` / `#191919` | 카카오 로그인 |
| `$brand-naver` | `#03c75a` | 네이버 로그인 — **현재 미사용** (SignUp 에서 네이버 가입 제거). 다시 붙일 때 쓰라고 토큰만 남겨 둔다 |

### 그라디언트

| 토큰 | 값 | 용도 |
|---|---|---|
| `$avatar-gradient` | `linear-gradient(135deg, #b6c1de, #7f8fb8)` | 사용자 아바타 |

### 겹쳐 뜨는 표면

| 토큰 | 값 | 용도 |
|---|---|---|
| `$glass-surface` | `rgba(255, 255, 255, 0.92)` | 콘텐츠 위에 겹쳐 뜨는 버튼·바. `backdrop-filter` 와 함께 사용 |

> 겹쳐 뜨는 표면은 **거의 불투명하게** 둡니다. 뒤 글자가 비치면 버튼 글씨와 본문이 섞여
> 둘 다 읽기 어려워집니다. 투명도는 "떠 있다"를 알리는 정도까지만 씁니다.

---

## 2. Typography

폰트 사이즈·굵기·행간은 `_variables.scss` 의 스케일 토큰에서만 고릅니다.
반복되는 텍스트 스타일은 `_typography.scss` 의 믹스인으로 `@include t.body` 처럼 재사용하세요.

### 폰트 패밀리
- Sans: `$font-sans` (Pretendard 우선)
- Mono: `$font-mono` (SFMono/Consolas)

### 사이즈 스케일

| 토큰 | px | 용례 |
|---|---:|---|
| `$font-size-xs` | 12 | 캡션·라벨·오버라인 |
| `$font-size-sm` | 13 | 힌트·메타 |
| `$font-size-md` | 14 | 본문 보조·버튼 sm |
| `$font-size-base` | 15 | **기본 본문·버튼** |
| `$font-size-lg` | 16 | 리드 본문 |
| `$font-size-xl` | 17 | 소제목 |
| `$font-size-2xl` | 19 | 카드 제목 |
| `$font-size-3xl` | 22 | 페이지 소제목 |
| `$font-size-4xl` | 26 | 페이지 제목 |
| `$font-size-5xl` | 32 | 대형 제목 |
| `$font-size-display` | 44 | 히어로 |

### 굵기

`$font-weight-regular(400)` / `medium(500)` / `semibold(600)` / `bold(700)` / `extrabold(800)`

### 행간

`$line-height-tight(1.2)` / `snug(1.35)` / `normal(1.5)` / `relaxed(1.65)` / `loose(1.75)`

### letter-spacing

`$tracking-tight(-0.035em)` / `snug(-0.03em)` / `normal(-0.02em)` / `body(-0.01em, body 기본)` / `wide(0.02em)` / `wider(0.04em)`

### 타입 스케일 (Typography 믹스인)

`_typography.scss` 를 `@use '../../styles/typography' as t;` 로 불러 사용합니다.

| 믹스인 | 크기 | weight | 용도 |
|---|---|---|---|
| `t.display` | 34–52 (clamp) | 800 | 히어로 헤드라인 |
| `t.h1` | 28–38 | 800 | 페이지 상단 제목 |
| `t.h2` | 24–32 | 700 | 섹션 제목 |
| `t.h3` | 22 | 700 | 하위 섹션 제목 |
| `t.title` | 19 | 700 | 카드·모달 제목 |
| `t.subtitle` | 17 | 700 | 카드 소제목 |
| `t.body` | 15 | 400 | **기본 본문** |
| `t.body-sm` | 14 | 400 | 보조 본문 |
| `t.caption` | 13 | 400 | 캡션 (`$slate` 색) |
| `t.label` | 12 | 500 (letter-spacing 0.05em) | 폼 라벨 |
| `t.overline` | 12 | 700 (uppercase) | 오버라인·태그 |
| `t.button-text` / `button-text-sm` | 15/14 | 600 | 버튼 |
| `t.code` | 0.9em (mono) | – | 코드 |

**규칙**: 여기 없는 크기/굵기 조합을 새로 만들지 말고, 필요하면 이 문서와 `_typography.scss` 에 먼저 추가하세요.

---

## 3. Spacing

4pt 스케일을 사용합니다. padding/margin/gap 은 반드시 이 값에서 고릅니다.

| 토큰 | px |
|---|---:|
| `$space-1` | 4 |
| `$space-2` | 8 |
| `$space-3` | 12 |
| `$space-4` | 16 |
| `$space-5` | 20 |
| `$space-6` | 24 |
| `$space-7` | 28 |
| `$space-8` | 32 |
| `$space-10` | 40 |
| `$space-12` | 48 |
| `$space-14` | 56 |
| `$space-16` | 64 |
| `$space-18` | 72 |
| `$space-20` | 80 |
| `$space-22` | 88 |
| `$space-24` | 96 |

**규칙**: 임의의 `padding: 13px` 같은 값을 새로 만들지 마세요.
페이지 컨테이너의 좌우 여백은 `padding-inline: $space-6 (24px)` 로 통일.

---

## 4. Radius

| 토큰 | px | 용도 |
|---|---:|---|
| `$radius-xs` | 6 | 태그·세그먼트 |
| `$radius-sm` | 8 | 소형 버튼·인풋 |
| `$radius-md` | 10 | 표준 버튼·카드 내부 |
| `$radius` | 12 | 기본 (여러 카드 내부) |
| `$radius-lg` | 16 | 카드·모달 (기본 카드) |
| `$radius-xl` | 20 | 대형 카드·벤토 |
| `$radius-2xl` | 22 | 특수 (레거시) |
| `$radius-pill` | 999px | pill·토글 |

---

## 5. Shadow

| 토큰 | 용도 |
|---|---|
| `$shadow-xs` | 미세 강조 (업로드 카드) |
| `$shadow-sm` | 인용 카드 |
| `$shadow-md` | 폼 카드 (login/signup) |
| `$shadow-lg` | 강조 드롭 (히어로 목업) |
| `$shadow-elevated` | 팝오버·유저 메뉴 |
| `$shadow-modal` | 모달 다이얼로그 |
| `$shadow-btn-primary` | Primary 버튼 |
| `$shadow-toast` | 토스트 |
| `$shadow-fab` | 콘텐츠 위에 떠 있는 액션 버튼 (챗 모바일 액션) |

---

## 6. Border

기본은 `1px solid v.$border-*` 형태. 강조 카드는 `border-left: 6px solid` 로 좌측 강조. 대시 보더는 `1.5px dashed v.$border-strong` (드롭존).

---

## 7. Z-index

| 토큰 | 값 | 용도 |
|---|---:|---|
| `$z-base` | 0 | 기본 |
| `$z-sticky` | 30 | sticky 사이드바 |
| `$z-fab` | 40 | 플로팅 액션 버튼 |
| `$z-header` | 50 | 사이트 헤더 (sticky) |
| `$z-menu` | 60 | 팝오버·유저 메뉴 |
| `$z-drawer` | 90 | 좌측 슬라이드 드로어 |
| `$z-modal` | 100 | 모달 백드롭 |
| `$z-toast` | 200 | 토스트 |

> `$z-drawer` 가 `$z-modal` 보다 **낮아야** 합니다. 드로어 안의 목록에서 제목 수정·삭제 모달이
> 열리므로, 순서가 뒤집히면 모달이 드로어에 가려집니다.

---

## 8. Transition

hover·클릭 등 마이크로 인터랙션은 아래 네 개만 사용합니다.

| 토큰 | 값 | 용도 |
|---|---|---|
| `$transition-fast` | `0.12s ease` | 클릭 반응 (transform) |
| `$transition-base` | `0.15s ease` | 기본 hover (색·배경) |
| `$transition-slow` | `0.2s ease` | 슬라이드·페이드 |
| `$transition-expand` | `0.22s cubic-bezier(0.32, 0.72, 0, 1)` | 폭이 늘어나는 전환 (드로어 진입, 확장형 버튼) |

반드시 `@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }` 를 페이지 하단에 두세요 (이미 여러 페이지에 적용됨).

---

## 9. Breakpoint

| 토큰 | max-width | 대상 |
|---|---:|---|
| `$bp-sm` | 480px | 모바일 |
| `$bp-md` | 640px | 작은 태블릿 |
| `$bp-lg` | 820px | 태블릿 |
| `$bp-xl` | 960px | 랩탑 이하 |
| `$bp-2xl` | 1120px | 콘텐츠 최대폭 |

`@media (max-width: v.$bp-md)` 형식으로 사용하세요.

### 모바일 전환 기준 — `$bp-lg` (820px)

데스크탑 네비/사이드바가 사라지고 햄버거·드로어로 바뀌는 지점은 **`$bp-lg` 하나**로 통일합니다.
헤더와 챗 화면이 서로 다른 지점에서 전환되면 그 사이 폭에서 이동 수단이 통째로 사라집니다.

### JS 에서 화면 크기로 분기할 때

CSS 로 감출 수 없는 경우(중복 마운트가 부작용을 만드는 경우)에만 JS 로 분기하고,
**반드시 `hooks/useMediaQuery` 의 `useIsMobile()`** 을 씁니다. 쿼리 문자열은 그 파일의
`MOBILE_QUERY` 한 곳에서만 관리하며, 값을 바꿀 때는 `$bp-lg` 와 **함께** 고칩니다.

```tsx
const isMobile = useIsMobile()
{isMobile ? <Drawer …>{panel}</Drawer> : <aside>{panel}</aside>}
```

---

## 10. Layout 규칙

- **콘텐츠 컨테이너**: `max-width: v.$content-max` (1120px), `padding-inline: v.$space-6` (24px), `margin-inline: auto`.
- **폼 카드**: `max-width: v.$form-max` (440px).
- **헤더 높이**: `v.$header-height` (66px). 페이지가 sticky 요소를 두면 이 값을 기준으로 오프셋.
- **채팅 사이드바 폭**: `v.$sidebar-width` (300px).
- **업로드 드롭 영역 높이**: `v.$upload-drop-height` (152px). 파일 개수와 무관하게 고정하고, 넘치면 목록 안에서만 스크롤한다(카드가 자라 페이지가 밀리지 않게).
- 페이지 상하 padding은 대체로 `48px 0 96px` 또는 `56px 16px 72px`.
- **가변 폭 그리드는 `minmax(0, 1fr)`** 로 쓴다. 그냥 `1fr` 이면 `white-space: nowrap` 인 자식(예: 파일명)이 트랙의 min-content 를 밀어올려 좁은 화면에서 페이지가 가로로 넘친다.

---

## 11. Icon 규칙

- lucide 스타일의 stroke 아이콘 (`components/icons.tsx` 정의).
- 표준 사이즈 20×20 (`svg { width: 20px; height: 20px; }`).
- 버튼 내부 아이콘 16–18px, 대형 강조 22–24px, 히어로 30–34px.
- 색은 자체 색을 넣지 말고 부모의 `color:` 를 상속받게 둡니다(`currentColor` 활용).

---

## 12. Button 규칙

현재 반복되고 있는 버튼 패턴 (Home, RiskReport, Support, NotFound, Login, SignUp 등):

- **Primary**: `background: v.$navy-800; color: v.$text-on-dark; box-shadow: v.$shadow-btn-primary;` hover → `v.$navy-hover`.
- **Ghost**: `background: v.$surface; color: v.$navy-800; border: 1px solid v.$border-strong;` hover → `background: v.$page-bg`.
- **Outline**: `background: transparent; border: 1px solid v.$border-strong; color: v.$navy-800;`
- **Danger link**: `color: v.$red` + underline hover (예: MyPage 의 "회원 탈퇴" 진입).
- **Danger solid**: `background: v.$red; color: v.$text-on-dark;` hover → `v.$red-hover`. 되돌릴 수 없는
  확정 액션(회원 탈퇴 등)에만 쓰고, 확인 모달의 마지막 버튼 자리에만 둡니다.
  비활성(동의 전)은 `opacity: 0.45; cursor: not-allowed;` 로 색을 바꾸지 않고 낮춥니다.
- 사이즈: `padding: 13px 22px` (기본), `padding: 10px 18px` (compact).
- radius: 기본 `$radius` (12px), compact `$radius-md` (10px).
- 텍스트: `@include t.button-text` (15/600).

> **다음 단계**: 반복이 이미 rule of three 를 넘겼으므로 `components/Button/Button.tsx` 로 추출 예정. 신규 페이지는 추출 후 그 컴포넌트를 사용하세요.

---

## 13. Form 규칙

- 필드는 세로 스택 (`display: flex; flex-direction: column; gap: $space-2`).
- 라벨은 `@include t.label` + 마진 `margin-left: 2px`.
- 인풋: `padding: 13px 16px; border: 1px solid v.$border-strong; border-radius: v.$radius-sm; background: v.$surface-raised;` focus → `border-color: v.$navy-800; box-shadow: 0 0 0 4px rgba(23,34,74,0.1);`.
- 힌트: `@include t.caption` (성공은 `v.$green`, 오류는 `v.$red`).
- 체크박스·라디오: `accent-color: v.$navy-800`.

---

## 14. Card 규칙

- 표준 카드: `background: v.$surface; border: 1px solid v.$border-default; border-radius: v.$radius-lg; padding: $space-8 (32px);`
- 옅은 그림자를 원하면 `$shadow-xs` 또는 `$shadow-sm`.
- 강조 카드 (액션): `background: v.$navy-800; color: v.$text-on-dark; box-shadow: 0 20px 44px -20px rgba(15,26,53,0.4);`
- 위험·안전 강조: 좌측 6px border 색만 시맨틱으로 (`clause_risk` 패턴 참고 — `RiskReport`).

---

## 15. 컴포넌트 사용 예시

### 페이지 스캐폴딩

```scss
@use '../../styles/variables' as v;
@use '../../styles/typography' as t;

.page {
  background: v.$page-bg;
  min-height: 100%;
  padding: v.$space-12 0 v.$space-24;
}
.container {
  width: 100%;
  max-width: v.$content-max;
  margin: 0 auto;
  padding-inline: v.$space-6;
}
.title {
  @include t.h1;
  color: v.$navy-900;
}
.subtitle {
  @include t.body;
  margin-top: v.$space-2;
  color: v.$slate;
}
```

### 반응형

```scss
@media (max-width: v.$bp-md) {
  .grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; }
}
```

---

## 16. 공통 컴포넌트 인벤토리 (현재)

`frontend/src/components/*` 에 존재:

| 컴포넌트 | 위치 | 용도 |
|---|---|---|
| `SiteHeader` | `components/SiteHeader/` | 상단 sticky 헤더 (로고·네비·유저 메뉴) |
| `SiteFooter` | `components/SiteFooter/` | 하단 다크 푸터 / compact 스트립 |
| `Modal` | `components/Modal/` | 다이얼로그 (헤더·바디·백드롭·ESC 닫힘, 초기 포커스 지정 가능, `describedBy` 로 `aria-describedby` 연결 가능) |
| `Drawer` | `components/Drawer/` | 좌측 슬라이드 오버레이. 모바일 네비·챗 대화기록 공용 (`open`·`onClose`·`title`) |
| `Toast` (`Toaster`) | `components/Toast/` | 알림 (success/error/info) |
| `LegalDoc` | `components/LegalDoc/` | 약관·개인정보 문서 프레임 (blocks 포함) |
| `HealthStatus` | `components/HealthStatus/` | 백엔드 헬스 체크 칩 (dev only) |
| `RequireAuth` | `components/RequireAuth/` | 라우트 가드 |
| `ErrorModal` | `components/ErrorModal/` | 글로벌 에러 모달 (store 기반). 모든 API 실패가 여기로 모인다 |
| `ErrorState` | `components/ErrorState/` | 데이터를 못 불러온 영역의 자리표시 + 다시 시도. `action` 으로 대체 행동(예: "새 대화 시작"), `variant="plain"` 으로 테두리 없는 형태 |
| `icons` | `components/icons.tsx` | stroke 아이콘 |

> **API 실패는 Empty State 로 그리지 않는다.** "데이터가 없습니다" 는 성공 응답의 0건 전용이고,
> 실패한 영역에는 `<ErrorState />` 를 놓는다(원인 안내는 보통 `ErrorModal` 이 맡음). 자세한 규칙은
> `frontend/CLAUDE.md` 의 「API 에러 처리」 참고.
>
> **화면 전체가 실패로 덮이는 자리에서는 모달을 끈다.** 대화 열기처럼 `<ErrorState />` 가 화면을
> 가득 채우면 모달은 같은 말을 두 번 하는 꼴이고, 닫고 나면 아무 안내도 남지 않는다. 이럴 땐
> `{ silent: true }` 로 모달을 끄고 서버 문구(`ApiError.message`)를 `<ErrorState variant="plain">`
> 에 그대로 넘긴다. 재시도가 없는 실패(404 등)는 `action` 으로 빠져나갈 길을 함께 준다 —
> 버튼 없는 오류 화면은 막다른 길이다.

관련 훅 (`frontend/src/hooks/*`):

| 훅 | 용도 |
|---|---|
| `useOverlayDismiss` | 화면을 덮는 오버레이 공통 동작 — ESC 닫기·포커스 트랩·배경 스크롤 잠금·포커스 복원. `Modal`·`Drawer` 가 공유 |
| `useMediaQuery` / `useIsMobile` | 화면 크기 분기 (§9 참고) |
| `useHideOnScrollDown` | 아래로 스크롤하면 감추고 위로 올리면 되돌리는 토글. 콘텐츠 위에 겹쳐 뜨는 요소에 사용 |

> **콘텐츠 위에 겹쳐 뜨는 요소는 자리를 예약하지 말고 비켜나게 만듭니다.** 상단에 빈 띠를
> 남겨 두면 좁은 화면에서 그만큼 대화가 줄어듭니다. `useHideOnScrollDown` 으로 읽는 동안
> 걷어내고, 스크롤 컨테이너 **안쪽** padding 으로 맨 위에서만 첫 줄이 가리지 않게 합니다.

> **데스크탑과 모바일이 같은 목록을 보여줘야 하면 컴포넌트를 하나만 만들고 그릇만 바꾼다.**
> 예: 챗 대화기록은 `pages/Chat/ChatHistoryPanel` 하나를 데스크탑 `<aside>` 와 모바일 `<Drawer>`
> 가 그대로 재사용한다. 레이아웃 차이는 `variant` prop 한 개로만 흡수한다.

### 향후 컴포넌트화 계획 (rule of three 충족)

아래는 이미 여러 페이지에 반복 구현되어 있어 추출 예정:

- **Button** — Home, RiskReport, Support, NotFound, Login, SignUp 에서 `.btnPrimary/.btnGhost/.btnOutline` 이 반복. 다음 리팩터 단계에서 `components/Button/Button.tsx` 로.
- **Input / Field** — Login, SignUp 에서 동일 스타일 반복.
- **Card** — 여러 페이지에서 동일 표준 카드가 반복 (Card, Header, Body 슬롯).
- **Badge / Pill** — `historyItem`, `warnPill`, `hotTag`, `tierBadge` 등.
- **EmptyState** — Chat, MyPage 에서 등장.
- **SectionHeader** — `sectionTitle` + `sectionSub` 조합이 여러 곳에.
- **FileUpload / FileRow** — 현재는 `pages/Analyze` 에만 있다(고정 높이 드롭 영역 + 내부 스크롤 파일 목록 + 파일명·용량·제거 행). 검증과 **거부 사유 문구 생성**은 `pages/Analyze/uploadFiles.ts` 에 순수 함수(`mergeFiles`·`describeRejections`)로 분리해 두었으니, 다른 화면에서 두 번째 업로드 UI 가 생기면 그 파일부터 `utils` 로 올리고 UI 를 `components/` 로 추출한다.
  - 거부(확장자·용량·중복)는 **카드 안 인라인 문구가 아니라 토스트**로 알린다. 문구에 서류명과 파일명을 담고, 중복은 실패가 아니므로 `info`·나머지는 `error`. 클라이언트 검증 알림에 `showToast` 를 쓰는 것은 `frontend/CLAUDE.md` 가 허용한 예외다(`SignUp` 폼 검증과 같은 취급).

신규 페이지에서 이들 반복 패턴이 필요하면 **여기 컴포넌트로 추출한 뒤** 사용하세요. 페이지 로컬 CSS 로 새로 만드는 것은 지양합니다.

---

## 17. 새 페이지를 만들 때 체크리스트

1. **디자인 토큰 참조**: `@use '../../styles/variables' as v;` + `@use '../../styles/typography' as t;`
2. **페이지 배경**: `background: v.$page-bg` (예외 없음).
3. **컨테이너**: `max-width: v.$content-max`, `padding-inline: v.$space-6`.
4. **타이포**: `@include t.h1;` 등 믹스인 우선. 새 크기 조합 만들지 않음.
5. **색상**: 하드코딩 없이 토큰만. 부족하면 `_variables.scss` 에 먼저 추가.
6. **spacing**: 4pt 스케일 (`$space-*`) 만.
7. **radius/shadow**: 정의된 토큰만.
8. **반응형**: `$bp-*` 브레이크포인트만.
9. **애니메이션**: `$transition-*` 만. `prefers-reduced-motion` 대응 필수.
10. **컴포넌트**: 반복 패턴이면 `components/*` 확인 → 없으면 새로 만들지 말고 이 문서 §16 에 추가 요청.

---

## 18. 절대 하지 말 것 (Anti-patterns)

- ❌ 임의의 색상값 (`#f4f6fc`, `#9aa3b8` 같은 one-off) 을 SCSS 에 하드코딩.
- ❌ 임의의 폰트 크기/굵기 조합 (`font-size: 14.5px` 같은 반쪽 값 남발).
- ❌ 임의의 padding (`padding: 13px 22px` 같은 스케일 밖 값). 필요하면 스케일에 추가.
- ❌ 페이지 배경으로 `$page-bg` 외의 색을 사용.
- ❌ 컴포넌트 안에서 로컬 버튼/인풋을 새로 만드는 것 (이미 존재 여부 확인 필수).
- ❌ 인라인 스타일 (`style={{ color: '#xxx' }}`) — 항상 CSS Modules.
- ❌ Tailwind class — 이 프로젝트는 SCSS Modules 만 사용합니다.
- ❌ **hover 로만 나타나는 조작 버튼.** 터치 기기에는 hover 가 없어 기능에 영영 닿을 수 없습니다.
  `opacity: 0` + `:hover` 패턴을 쓸 거면 `@media (hover: none)` 에서 항상 보이게 열어 두세요.
- ❌ **좁은 화면에서 UI 를 `display: none` 으로 지우고 대체 수단을 두지 않는 것.**
  네비게이션·목록을 감출 거면 햄버거·FAB·드로어 같은 대체 진입점을 반드시 함께 만듭니다.

---

## 19. 문서 동기화 규칙

- **토큰을 추가/수정할 때**: `_variables.scss` 와 이 문서를 **함께** 업데이트하세요.
- **새 컴포넌트를 추출할 때**: §16 인벤토리에 추가하세요.
- **새 anti-pattern 을 발견하면**: §18 에 추가하세요.

design.md 는 문서일 뿐만 아니라 계약입니다. 이 문서와 다른 코드가 있으면 코드를 문서에 맞추세요.
