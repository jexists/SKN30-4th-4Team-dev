/**
 * 앱 전역 설정 한 곳.
 *
 * - `ENV` — 배포마다 값이 달라지는 것만. 환경변수를 읽는 곳은 이 파일뿐이고,
 *   `.env` 는 커밋되지 않으므로 **기본값만으로 항상 동작해야 한다.** (.env.example 참고)
 * - `BRAND` — 환경과 무관한 제품 상수. 커밋되는 값이라 여기서 직접 관리한다.
 */
export const ENV = {
  /** 비우면 vite 프록시(/api → :8000)를 탄다. */
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  /** Supabase Auth 연결값 (대시보드 → Settings → API). 비면 인증 비활성. */
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
  /**
   * 로컬 개발 서버 여부. DEV 는 테스트 환경에서도 true 라서 MODE 로 비교한다.
   * (dev 전용 UI 가 테스트에서 렌더되면 불필요한 요청이 나간다.)
   */
  isDev: import.meta.env.MODE === 'development',
} as const

/** 서비스 표기. 이름을 바꿀 땐 여기만 고치면 화면 전체에 반영된다. */
export const BRAND = {
  /** 로고·푸터 워드마크 등 영문 표기 */
  name: 'HomeShield',
  /** 본문 문장 안에서 쓰는 한글 표기 */
  nameKo: '홈쉴드',
  /** 브라우저 탭 제목에 붙는 한 줄 소개 */
  tagline: '안전한 임대차 계약',
} as const

/** 저작권 표기에 쓰는 법인명 — "HomeShield Legal Tech" */
export const BRAND_LEGAL_NAME = `${BRAND.name} Legal Tech`

/**
 * 이용약관·개인정보처리방침·법적 근거 문서의 시행일 등.
 *
 * 문서 본문(`content/legal.ts`, `content/legalBasis.ts`)이 이 값을 참조해 화면에 표시한다.
 * 실제 공개·개정 시점이 정해지면 여기 값만 바꾸면 모든 문서·화면에 한 번에 반영된다.
 */
export const LEGAL_DATES = {
  /** 이용약관 시행일 */
  termsEffectiveDate: '2026년 7월 30일',
  /** 개인정보처리방침 공고일 (시행 7일 전 공지) */
  privacyAnnouncedDate: '2026년 7월 30일',
  /** 개인정보처리방침 시행일 */
  privacyEffectiveDate: '2026년 7월 30일',
  /** 법적 근거 문서 작성일 */
  legalBasisWrittenDate: '2026년 7월 30일',
} as const

/** 브라우저 탭 제목 — "HomeShield — 안전한 임대차 계약" */
export const BRAND_PAGE_TITLE = `${BRAND.name} — ${BRAND.tagline}`
