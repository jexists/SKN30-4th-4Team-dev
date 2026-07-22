import { useCallback, useSyncExternalStore } from 'react'

/**
 * 로그인 세션 훅.
 *
 * Supabase Auth 연동 전까지는 localStorage 토큰 유무로만 로그인 여부를 판정하는 임시 구현이다.
 * 실제 인증을 붙일 때 이 파일(readToken·signIn·signOut)만 교체하면
 * RequireAuth 등 사용하는 쪽 코드는 그대로 둘 수 있다.
 */
export const AUTH_TOKEN_KEY = 'homeshield.accessToken'

const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

// 다른 탭에서 로그인/로그아웃한 경우도 반영한다. (모듈당 한 번만 등록)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', notify)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY)
}

export function useAuth() {
  const token = useSyncExternalStore(subscribe, readToken, () => null)

  const signIn = useCallback((accessToken: string) => {
    localStorage.setItem(AUTH_TOKEN_KEY, accessToken)
    notify()
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    notify()
  }, [])

  return { token, isAuthed: token !== null, signIn, signOut }
}
