import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "토큰 문자열이 있다" 와 "그 토큰이 아직 쓸 수 있다" 를 구분하는지 확인한다.
 * 예전에는 만료된 세션도 로그인으로 판정해, 화면은 로그인 상태인데 API 는 전부
 * 401 이 나는 상태에 갇혔다.
 */

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock('../config/supabase', () => ({
  supabase: { auth },
  isAuthConfigured: true,
}))

const HOUR = 3600

/** 세션 스토어가 모듈 단위 싱글턴이라, 테스트마다 새로 읽어야 초기 동기화를 볼 수 있다. */
async function loadAuth() {
  vi.resetModules()
  return import('./useAuth')
}

function sessionExpiringIn(seconds: number) {
  return {
    data: {
      session: {
        access_token: 'token-abc',
        expires_at: Math.floor(Date.now() / 1000) + seconds,
      },
    },
    error: null,
  }
}

beforeEach(() => {
  auth.getSession.mockReset()
  auth.signOut.mockReset()
  auth.onAuthStateChange.mockReset()
  auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
})

describe('useAuth', () => {
  it('만료 시각이 지난 세션은 토큰이 있어도 로그인으로 치지 않는다', async () => {
    auth.getSession.mockResolvedValue(sessionExpiringIn(-HOUR))
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.token).toBe('token-abc') // 저장소엔 남아 있지만
    expect(result.current.isAuthed).toBe(false) // 로그인 상태는 아니다
  })

  it('아직 유효한 세션은 로그인으로 본다', async () => {
    auth.getSession.mockResolvedValue(sessionExpiringIn(HOUR))
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.isAuthed).toBe(true))
  })

  it('getSession 이 실패하면 비로그인으로 본다', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('offline') })
    const { useAuth } = await loadAuth()

    const { result } = renderHook(() => useAuth())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.isAuthed).toBe(false)
  })

  it('expireSession 은 로그아웃시키고 만료 표시를 남긴다', async () => {
    const { useAuth, signIn, expireSession } = await loadAuth()
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false)) // 초기 동기화 완료 대기

    act(() => signIn('token-abc'))
    expect(result.current.isAuthed).toBe(true)

    act(() => expireSession())

    expect(result.current.isAuthed).toBe(false)
    expect(result.current.sessionExpired).toBe(true)
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('사용자가 직접 로그아웃하면 만료 표시를 남기지 않는다', async () => {
    const { useAuth, signIn, signOut } = await loadAuth()
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => signIn('token-abc'))
    act(() => signOut())

    expect(result.current.isAuthed).toBe(false)
    expect(result.current.sessionExpired).toBe(false)
  })

  it('다시 로그인하면 만료 표시가 사라진다', async () => {
    const { useAuth, signIn, expireSession } = await loadAuth()
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    act(() => expireSession())
    expect(result.current.sessionExpired).toBe(true)

    act(() => signIn('new-token'))

    expect(result.current.sessionExpired).toBe(false)
    expect(result.current.isAuthed).toBe(true)
  })
})
