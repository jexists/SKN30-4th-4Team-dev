import { useSyncExternalStore } from 'react'

import { supabase } from '../config/supabase'

/**
 * 로그인 세션 훅 — **Supabase 세션이 유일한 진실**이다.
 *
 * getSession 으로 초기 세션을 읽고 onAuthStateChange 가 발생할 때마다 현재 탭의 세션을
 * 다시 확인한다. 따로 토큰을 localStorage 에 복사해두지 않으므로, 세션이 만료·갱신·
 * 종료되면 isAuthed 가 즉시 따라간다(옛 토큰으로 Supabase 를 직접 호출해 401 나는 문제 제거).
 *
 * 다만 '토큰 문자열이 있다'와 '그 토큰이 아직 유효하다'는 다르다. 그래서
 * - 만료 시각(expires_at)이 지난 세션은 로그인으로 치지 않고,
 * - 서버가 401 로 세션을 거부하면 api/client.ts 가 expireSession() 으로 알려준다.
 * 후자가 최종 판단이다 — 클라이언트 시계가 틀리면 만료 검사만으로는 못 걸러낸다.
 *
 * Supabase 미설정(로컬/테스트, supabase === null)일 때는 인증이 불가능하므로
 * 세션은 signIn/signOut 으로만 제어된다(테스트가 이 경로를 쓴다).
 */

interface AuthState {
  /** 현재 액세스 토큰. 없으면 비로그인. */
  token: string | null
  /** 액세스 토큰 만료 시각(epoch 초). 모르면 null → 만료 검사를 건너뛴다. */
  expiresAt: number | null
  /** 초기 세션을 아직 읽는 중인지. 이 동안은 로그인 판정을 미룬다. */
  loading: boolean
  /** 사용자가 직접 로그아웃한 게 아니라 세션이 끊겨서 로그아웃된 상태인지(로그인 화면 안내용). */
  expired: boolean
}

let state: AuthState = { token: null, expiresAt: null, loading: Boolean(supabase), expired: false }
let started = false
const listeners = new Set<() => void>()

function setState(next: AuthState) {
  if (
    state.token === next.token &&
    state.expiresAt === next.expiresAt &&
    state.loading === next.loading &&
    state.expired === next.expired
  ) {
    return
  }
  state = next
  listeners.forEach((listener) => listener())
}

/** 현재 탭의 저장소를 기준으로 인증 상태를 맞춘다. */
async function syncSession() {
  if (!supabase) return

  const { data, error } = await supabase.auth.getSession()
  const session = error ? null : data.session
  setState({
    token: session?.access_token ?? null,
    expiresAt: session?.expires_at ?? null,
    loading: false,
    // 세션이 새로 잡히면 만료 안내를 거둔다. 없을 땐 직전 판정을 유지한다
    // (expireSession 이 부른 signOut 의 SIGNED_OUT 이 여기로 되돌아오기 때문).
    expired: session ? false : state.expired,
  })
}

/** 첫 구독 시 한 번만 Supabase 세션을 읽고 변화를 구독한다. */
function start() {
  if (started) return
  started = true

  if (!supabase) {
    // 인증 미설정 — 로딩만 끝내고, 세션은 signIn/signOut 으로만 바뀐다.
    if (state.loading) setState({ ...state, loading: false })
    return
  }

  void syncSession()

  // 다른 탭의 이벤트에는 현재 탭의 sessionStorage 에 없는 세션이 담길 수 있으므로,
  // 이벤트의 session 을 그대로 쓰지 않고 이 탭의 저장소를 다시 확인한다.
  supabase.auth.onAuthStateChange(() => {
    void syncSession()
  })
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): AuthState {
  return state
}

function getServerSnapshot(): AuthState {
  return { token: null, expiresAt: null, loading: false, expired: false }
}

/** 토큰이 있고 아직 만료되지 않았는지. 만료 시각을 모르면 있는 것으로 본다. */
function isUsable({ token, expiresAt }: AuthState): boolean {
  if (token === null) return false
  return expiresAt === null || expiresAt * 1000 > Date.now()
}

/**
 * 로그인 성공 직후 세션을 즉시 반영한다(내비게이션 레이스 방지 + 테스트용).
 * 실제 값은 이후 onAuthStateChange 가 최신 토큰으로 계속 갱신한다.
 */
export function signIn(accessToken: string) {
  setState({ token: accessToken, expiresAt: null, loading: false, expired: false })
}

/** 로그아웃 — 로컬 상태를 즉시 비우고 Supabase 세션도 종료(미설정이면 no-op). */
export function signOut() {
  setState({ token: null, expiresAt: null, loading: false, expired: false })
  void supabase?.auth.signOut()
}

/**
 * 서버가 세션을 거부(401)했을 때 호출한다 — api/client.ts 가 갱신까지 실패한 뒤 부른다.
 *
 * signOut 과 달리 '만료됨' 표시를 남겨, RequireAuth 가 로그인 화면으로 보낼 때
 * 왜 튕겼는지 알려줄 수 있게 한다.
 */
export function expireSession() {
  setState({ token: null, expiresAt: null, loading: false, expired: true })
  void supabase?.auth.signOut()
}

export function useAuth() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return {
    token: snapshot.token,
    isAuthed: isUsable(snapshot),
    isLoading: snapshot.loading,
    /** 세션이 끊겨 로그아웃된 상태인지(로그인 화면에서 안내를 띄운다). */
    sessionExpired: snapshot.expired,
    signIn,
    signOut,
  }
}
