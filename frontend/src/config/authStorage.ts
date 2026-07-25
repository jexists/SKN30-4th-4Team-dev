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

/** 로그인 상태 유지 선택값. 기본은 유지(true) — Supabase 기본 동작과 같다. */
export const keepSignedIn = {
  get: (): boolean => window.localStorage.getItem(KEEP_KEY) !== 'false',
  set: (value: boolean): void => window.localStorage.setItem(KEEP_KEY, String(value)),
}

/** 선택값에 따라 저장 위치를 바꾸는 Supabase storage 어댑터. */
export const authStorage = {
  // 어느 쪽에 저장했든 찾아낸다(선택값이 바뀐 뒤에도 기존 세션을 잃지 않게).
  getItem: (key: string): string | null =>
    window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key),

  setItem: (key: string, value: string): void => {
    // 한쪽에만 쓰고 반대쪽 잔여값은 지운다 — 두 저장소가 갈리면 옛 토큰이 되살아난다.
    const [target, other] = keepSignedIn.get()
      ? [window.localStorage, window.sessionStorage]
      : [window.sessionStorage, window.localStorage]
    other.removeItem(key)
    target.setItem(key, value)
  },

  removeItem: (key: string): void => {
    window.localStorage.removeItem(key)
    window.sessionStorage.removeItem(key)
  },
}
