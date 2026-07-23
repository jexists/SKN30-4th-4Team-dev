import { useCallback, useSyncExternalStore } from 'react'

import { supabase } from '../config/supabase'

/**
 * 로그인 세션 훅.
 *
 * 로그인 판정은 localStorage 의 access_token 유무로 한다(테스트·가드가 이 키에 의존).
 * 실제 인증은 Supabase Auth 가 담당 — 로그인/회원가입 성공 시 `signIn(session.access_token)`
 * 으로 이 키에 실제 토큰을 저장하고, 로그아웃 시 Supabase 세션도 함께 종료한다.
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
    void supabase?.auth.signOut() // Supabase 세션도 종료(미설정이면 no-op)
    notify()
  }, [])

  return { token, isAuthed: token !== null, signIn, signOut }
}
