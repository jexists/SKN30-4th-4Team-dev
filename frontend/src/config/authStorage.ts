/**
 * "로그인 상태 유지" 저장 전략.
 *
 * Supabase 는 createClient 시점에 storage 어댑터가 고정된다. 그래서 저장 위치를
 * **런타임에 고르는** 어댑터를 넣어, 사용자의 "로그인 상태 유지" 선택에 따라
 * localStorage(브라우저를 닫아도 유지) / sessionStorage(탭을 닫으면 로그아웃)로 분기한다.
 *
 * config/supabase.ts 와 분리해 둔 이유: 여러 테스트가 config/supabase 를 통째로 vi.mock
 * 하고 있어, 같은 모듈에 두면 Login 을 쓰는 테스트마다 mock 을 확장해야 한다. 독립 모듈이면
 * Supabase 없이도 단위 테스트가 된다.
 */

const KEEP_KEY = 'homeshield.keepSignedIn'

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

/** 로그인 상태 유지 선택값. 기본은 유지(true) — Supabase 기본 동작과 같다. */
export const keepSignedIn = {
  get: (): boolean => read('localStorage', KEEP_KEY) !== 'false',
  set: (value: boolean): void => write('localStorage', KEEP_KEY, String(value)),
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
