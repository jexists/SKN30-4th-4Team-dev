/**
 * "로그인 상태 유지" 저장 전략.
 *
 * Supabase 는 createClient 시점에 storage 어댑터가 고정된다. 그래서 저장 위치를
 * **런타임에 고르는** 어댑터를 넣어, "로그인 상태 유지" 값에 따라 localStorage(브라우저를
 * 닫아도 유지) / sessionStorage(탭을 닫으면 로그아웃)로 분기한다.
 *
 * 지금은 Login 화면에 이 값을 고르는 체크박스가 없다 — 로그인 직전 항상 true 로 정규화해서
 * 부른다(과거 버전에서 false 로 저장돼 있던 사용자가 sessionStorage 에 계속 갇히지 않도록).
 * 다만 저장 위치를 나누는 분기 로직 자체는 authStorage 어댑터가 계속 참조하므로 이 파일에
 * 남겨 둔다 — 나중에 다시 노출하거나 다른 정책이 필요해지면 그대로 재사용할 수 있다.
 *
 * config/supabase.ts 와 분리해 둔 이유: 여러 테스트가 config/supabase 를 통째로 vi.mock
 * 하고 있어, 같은 모듈에 두면 Login 을 쓰는 테스트마다 mock 을 확장해야 한다. 독립 모듈이면
 * Supabase 없이도 단위 테스트가 된다.
 */

const KEEP_KEY = 'homeshield.keepSignedIn'
const SAVED_EMAIL_KEY = 'homeshield.savedEmail'

type Where = 'localStorage' | 'sessionStorage'

/*
 * 저장소 접근은 언제든 던질 수 있다 — 사파리 프라이빗 모드·쿠키(사이트 데이터) 차단·용량
 * 초과에서는 window.localStorage 를 '읽는 것'조차 예외다. 이 어댑터는 Supabase Auth 의
 * 세션 흐름 한가운데서 호출되므로, 예외가 새어 나가면 저장 실패가 로그인 실패로 번진다.
 * 그래서 접근 자체를 try/catch 로 감싸고, 실패하면 "값이 없다"로 취급한다.
 */
function read(where: Where, key: string): string | null {
  try {
    return window[where].getItem(key)
  } catch {
    return null
  }
}

function write(where: Where, key: string, value: string): void {
  try {
    window[where].setItem(key, value)
  } catch {
    // 디스크에 남기지 못해도 Supabase 는 메모리의 세션으로 현재 탭을 계속 유지한다.
  }
}

function drop(where: Where, key: string): void {
  try {
    window[where].removeItem(key)
  } catch {
    // 지우지 못한 잔여값은 다음 저장·로그아웃 때 다시 지워진다.
  }
}

/**
 * 로그인 상태 유지 값. 예전엔 Login 화면 체크박스로 사용자가 직접 골랐지만, 지금은 그
 * 선택지가 없어 로그인 시 항상 true 로 정규화된다(파일 상단 설명 참고). get/set 은 여전히
 * authStorage 어댑터가 저장 위치를 고르는 데 쓰인다. 기본값은 유지(true) — Supabase 기본
 * 동작과 같다.
 */
export const keepSignedIn = {
  get: (): boolean => read('localStorage', KEEP_KEY) !== 'false',
  set: (value: boolean): void => write('localStorage', KEEP_KEY, String(value)),
}

/**
 * 로그인 화면 "아이디 저장" 값. 비밀번호는 절대 담지 않고 이메일 문자열만 남긴다.
 * 과거에 빈 문자열/공백만 저장된 잔여값이 있을 수 있어 get() 에서 방어적으로 걸러낸다.
 */
export const savedEmail = {
  get: (): string | null => {
    const value = read('localStorage', SAVED_EMAIL_KEY)
    const trimmed = value?.trim()
    return trimmed ? trimmed : null
  },
  // get() 이 trim 해서 돌려주므로, 저장 시점에도 같은 값이 되도록 여기서 미리 trim 한다
  // (로그인 요청 자체에 넘어가는 이메일은 건드리지 않는다 — 저장 전용 정규화).
  set: (email: string): void => write('localStorage', SAVED_EMAIL_KEY, email.trim()),
  clear: (): void => drop('localStorage', SAVED_EMAIL_KEY),
}

/** 선택값에 따라 저장 위치를 바꾸는 Supabase storage 어댑터. */
export const authStorage = {
  // 어느 쪽에 저장했든 찾아낸다(선택값이 바뀐 뒤에도 기존 세션을 잃지 않게).
  getItem: (key: string): string | null => read('localStorage', key) ?? read('sessionStorage', key),

  setItem: (key: string, value: string): void => {
    // 한쪽에만 쓰고 반대쪽 잔여값은 지운다 — 두 저장소가 갈리면 옛 토큰이 되살아난다.
    const [target, other]: readonly [Where, Where] = keepSignedIn.get()
      ? ['localStorage', 'sessionStorage']
      : ['sessionStorage', 'localStorage']
    drop(other, key)
    write(target, key, value)
  },

  removeItem: (key: string): void => {
    drop('localStorage', key)
    drop('sessionStorage', key)
  },
}
