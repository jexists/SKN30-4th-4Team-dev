import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetNotificationStoreForTests,
  markAnalysisStarted,
  useNotificationPolling,
  useUnreadCount,
} from './useNotifications'

const getUnreadCount = vi.hoisted(() => vi.fn())
const listNotifications = vi.hoisted(() => vi.fn())
const listAnalyses = vi.hoisted(() => vi.fn())
const useAuth = vi.hoisted(() => vi.fn())

vi.mock('../api/notifications', () => ({
  getUnreadCount,
  listNotifications,
  markNotificationsRead: vi.fn(),
  deleteNotifications: vi.fn(),
}))
vi.mock('../api/analyses', () => ({ listAnalyses, getAnalysis: vi.fn(), startAnalysis: vi.fn() }))
vi.mock('./useAuth', () => ({ useAuth: () => useAuth() }))

/** 폴링 간격은 hasActiveAnalysis 가 정한다: 진행 중 5초, 평소 60초. */
const ACTIVE_MS = 5_000
const IDLE_MS = 60_000

function authed(sub: string) {
  // JWT 의 payload 부분만 진짜여도 subjectOf 가 sub 를 읽는다.
  const payload = btoa(JSON.stringify({ sub }))
  return { isAuthed: true, token: `header.${payload}.sig` }
}

beforeEach(() => {
  vi.useFakeTimers()
  getUnreadCount.mockResolvedValue({ count: 0 })
  listNotifications.mockResolvedValue({ items: [], next_cursor: null })
  listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
  useAuth.mockReturnValue(authed('user-1'))
})

afterEach(() => {
  __resetNotificationStoreForTests()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('useNotificationPolling', () => {
  it('로그인하지 않았으면 폴링하지 않는다', async () => {
    useAuth.mockReturnValue({ isAuthed: false, token: null })
    renderHook(() => useNotificationPolling())

    await act(() => vi.advanceTimersByTimeAsync(IDLE_MS * 2))
    expect(getUnreadCount).not.toHaveBeenCalled()
  })

  it('로그인하면 즉시 한 번 확인한다', async () => {
    renderHook(() => useNotificationPolling())

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getUnreadCount).toHaveBeenCalledTimes(1)
  })

  it('평소에는 느린 주기로만 돈다', async () => {
    renderHook(() => useNotificationPolling())
    await act(() => vi.advanceTimersByTimeAsync(0))

    await act(() => vi.advanceTimersByTimeAsync(ACTIVE_MS))
    expect(getUnreadCount).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(IDLE_MS))
    expect(getUnreadCount).toHaveBeenCalledTimes(2)
  })

  // 분석은 30초~2분이라 그동안만 자주 본다 — 늘 5초로 돌면 배터리·서버를 태운다.
  it('분석이 진행 중이면 빠른 주기로 바꾼다', async () => {
    renderHook(() => useNotificationPolling())
    await act(() => vi.advanceTimersByTimeAsync(0))
    getUnreadCount.mockClear()

    act(() => markAnalysisStarted())
    await act(() => vi.advanceTimersByTimeAsync(IDLE_MS))

    // 60초 동안 5초 간격이면 최소 열 번은 돈다(느린 주기라면 한 번뿐이다).
    expect(getUnreadCount.mock.calls.length).toBeGreaterThan(5)
  })

  it('탭이 숨겨져 있으면 서버를 부르지 않는다', async () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    try {
      renderHook(() => useNotificationPolling())
      await act(() => vi.advanceTimersByTimeAsync(IDLE_MS * 2))
      expect(getUnreadCount).not.toHaveBeenCalled()
    } finally {
      hidden.mockRestore()
    }
  })

  it('언마운트하면 폴링을 멈춘다', async () => {
    const { unmount } = renderHook(() => useNotificationPolling())
    await act(() => vi.advanceTimersByTimeAsync(0))
    getUnreadCount.mockClear()

    unmount()
    await act(() => vi.advanceTimersByTimeAsync(IDLE_MS * 3))
    expect(getUnreadCount).not.toHaveBeenCalled()
  })

  // 모듈 전역 스토어라 그냥 두면 같은 탭에서 계정을 바꿔도 이전 개수가 남는다.
  it('계정이 바뀌면 배지를 초기화한다', async () => {
    getUnreadCount.mockResolvedValue({ count: 7 })
    const { result, rerender } = renderHook(() => {
      useNotificationPolling()
      return useUnreadCount()
    })

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toBe(7)

    getUnreadCount.mockResolvedValue({ count: 0 })
    useAuth.mockReturnValue(authed('user-2'))
    rerender()
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current).toBe(0)
  })

  it('토큰만 갱신되면(같은 sub) 초기화하지 않는다', async () => {
    getUnreadCount.mockResolvedValue({ count: 4 })
    const { result, rerender } = renderHook(() => {
      useNotificationPolling()
      return useUnreadCount()
    })
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(result.current).toBe(4)

    // 같은 sub 의 새 토큰
    useAuth.mockReturnValue({ ...authed('user-1'), token: `${authed('user-1').token}2` })
    rerender()

    expect(result.current).toBe(4)
  })

  // 폴링은 silent 라 실패해도 조용해야 한다 — 다음 주기에 다시 시도한다.
  it('조회에 실패해도 폴링이 죽지 않는다', async () => {
    getUnreadCount.mockRejectedValueOnce(new Error('네트워크'))
    renderHook(() => useNotificationPolling())

    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(getUnreadCount).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(IDLE_MS))
    expect(getUnreadCount).toHaveBeenCalledTimes(2)
  })
})
