import { useEffect, useSyncExternalStore } from 'react'

import { listAnalyses } from '../api/analyses'
import { getUnreadCount, listNotifications, markNotificationsRead } from '../api/notifications'
import { showToast } from '../components/Toast/toastStore'
import { isTerminal } from '../types/analysis'
import type { AppNotification } from '../types/notification'
import { useAuth } from './useAuth'
import { canShowDesktopNotification, showDesktopNotification } from './desktopNotify'

/**
 * 알림 배지 상태 + 폴링 — useAvatar 와 같은 모듈 외부 스토어 패턴이다.
 *
 * 헤더(종 아이콘)·마이페이지(알림 설정)·분석 화면이 모두 같은 값을 봐야 하므로 어느 한
 * 화면의 로컬 state 로 두지 않는다.
 *
 * **왜 폴링인가**: 분석은 30초~2분짜리라 5초 폴링이면 체감 차이가 없다. Supabase Realtime 을
 * 쓰려면 notification 테이블에 RLS 정책과 grant 를 새로 만들어야 하고, 프론트가 DB 를 직접
 * 읽게 되어 "DB 접근은 백엔드 경유" 원칙에서 벗어난다.
 */

const DESKTOP_PREF_KEY = 'homeshield.reportAlertsEnabled'

/** 분석이 도는 동안엔 자주, 평소엔 뜸하게. 배터리·서버 양쪽을 아낀다. */
const ACTIVE_INTERVAL_MS = 5_000
const IDLE_INTERVAL_MS = 60_000

interface State {
  unreadCount: number
  /** 진행 중인 분석이 있는지 — 폴링 주기와 종 아이콘 펄스를 정한다. */
  hasActiveAnalysis: boolean
  /** 완료 알림을 받은 작업별 최종 상태 — 분석 화면도 Toast 와 같은 사실을 보게 한다. */
  analysisOutcomes: Readonly<Record<string, AnalysisOutcome>>
  desktopEnabled: boolean
}

export type AnalysisOutcome = 'SUCCEEDED' | 'FAILED'

function readPref(): boolean {
  try {
    return window.localStorage.getItem(DESKTOP_PREF_KEY) !== 'false'
  } catch {
    return true
  }
}

let state: State = {
  unreadCount: 0,
  hasActiveAnalysis: false,
  analysisOutcomes: {},
  desktopEnabled: readPref(),
}
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setState(patch: Partial<State>) {
  const next = { ...state, ...patch }
  if (
    next.unreadCount === state.unreadCount &&
    next.hasActiveAnalysis === state.hasActiveAnalysis &&
    next.analysisOutcomes === state.analysisOutcomes &&
    next.desktopEnabled === state.desktopEnabled
  ) {
    return
  }
  state = next
  emit()
}

// ── 읽기 ───────────────────────────────────────────────────────────────

export function useUnreadCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => state.unreadCount,
    () => 0,
  )
}

export function useHasActiveAnalysis(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.hasActiveAnalysis,
    () => false,
  )
}

/**
 * 특정 작업의 완료/실패 알림 상태.
 *
 * Toast 와 화면이 서로 다른 로컬 state 를 갱신하면 한쪽만 완료되는 모순이 생긴다.
 * 둘 다 이 알림 스토어에 기록된 동일한 이벤트를 사용한다.
 */
export function useAnalysisOutcome(jobId: string | null): AnalysisOutcome | null {
  return useSyncExternalStore(
    subscribe,
    () => (jobId ? (state.analysisOutcomes[jobId] ?? null) : null),
    () => null,
  )
}

export function useDesktopAlertsEnabled(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.desktopEnabled,
    () => true,
  )
}

// ── 쓰기 ───────────────────────────────────────────────────────────────

/**
 * 마이페이지의 "위험 보고서 생성 완료" 토글.
 *
 * **서버는 이 값과 무관하게 알림 행을 항상 만든다.** 이 토글이 정하는 건 데스크톱 배너와
 * 토스트를 띄울지뿐이다 — 꺼도 종 아이콘에는 그대로 쌓인다.
 */
export function setDesktopAlertsEnabled(next: boolean) {
  try {
    window.localStorage.setItem(DESKTOP_PREF_KEY, String(next))
  } catch {
    // 저장에 실패해도 이번 세션 동작은 유지된다.
  }
  setState({ desktopEnabled: next })
}

/** 서버가 알려준 안읽음 개수로 배지를 맞춘다(읽음·삭제 응답에 함께 온다). */
export function syncUnreadCount(count: number) {
  setState({ unreadCount: count })
}

/**
 * 분석을 막 접수했을 때. 폴링을 빠른 주기로 올린다.
 *
 * 이미 예약된 타이머는 느린 주기로 잡혀 있다 — 다시 걸지 않으면 최대 60초 뒤에야
 * 빨라진다. 접수 직후가 가장 자주 봐야 할 때이므로 여기서 즉시 다시 건다.
 */
export function markAnalysisStarted() {
  const wasIdle = !state.hasActiveAnalysis
  setState({ hasActiveAnalysis: true })
  if (wasIdle) schedule()
}

/**
 * 결과 화면이 종료 상태를 **직접** 봤을 때. 폴링을 느린 주기로 되돌린다.
 *
 * 결과 화면에서 알림을 읽음 처리하면 폴링이 그 완료 알림을 영영 못 보므로, 여기서
 * 알려주지 않으면 종 아이콘이 계속 펄스한다.
 */
export function markAnalysisFinished() {
  setState({ hasActiveAnalysis: false })
}

/**
 * WebSocket/SSE 등 다른 완료 이벤트 수단을 붙이더라도 같은 진입점을 사용한다.
 * 현재는 알림 폴링이 호출하며, 작업 ID가 있어야 화면의 해당 분석만 갱신한다.
 */
export function syncAnalysisOutcome(jobId: string, outcome: AnalysisOutcome) {
  const outcomes =
    state.analysisOutcomes[jobId] === outcome
      ? state.analysisOutcomes
      : { ...state.analysisOutcomes, [jobId]: outcome }
  setState({ hasActiveAnalysis: false, analysisOutcomes: outcomes })
}

/**
 * 어떤 리소스(분석 작업)의 알림을 읽음 처리한다. 결과 화면에 도착하면 부른다 —
 * 알림을 눌러 들어왔든 URL 로 직접 왔든, 이미 본 것이 배지에 남아 있으면 안 된다.
 *
 * **fail-soft**: 실패해도 결과 화면은 그대로 보여야 하므로 조용히 넘긴다(다음 폴링이 맞춘다).
 */
export async function markResourceNotificationsRead(resourceId: string) {
  try {
    const page = await listNotifications({ unread: true, limit: 50 })
    const ids = page.items.filter((item) => item.resource_id === resourceId).map((item) => item.id)
    if (!ids.length) return
    const result = await markNotificationsRead(ids)
    syncUnreadCount(result.unread_count)
  } catch {
    // 배지 정합은 폴링이 다시 맞춘다.
  }
}

// ── 폴링 ───────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let currentUser: string | null = null
/** 이미 배너를 띄운 알림. 같은 알림으로 두 번 놀라게 하지 않는다. */
let announced = new Set<string>()
/** 첫 폴링은 "지금까지 쌓인 것"이라 배너를 띄우지 않는다 — 로그인하자마자 배너 폭탄이 된다. */
let primed = false

/** JWT 의 sub. 계정이 바뀌었는지 판단하는 데만 쓴다(토큰 갱신으로는 안 바뀐다). */
function subjectOf(token: string | null): string | null {
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { sub?: string }).sub ?? null
  } catch {
    return null
  }
}

function reset() {
  stopPolling()
  currentUser = null
  announced = new Set()
  primed = false
  setState({ unreadCount: 0, hasActiveAnalysis: false, analysisOutcomes: {} })
}

function intervalMs(): number {
  return state.hasActiveAnalysis ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS
}

function schedule() {
  if (!running) return
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(tick, intervalMs())
}

async function tick() {
  if (!running) return
  // 탭이 보이지 않으면 건너뛴다 — 배터리를 태우면서 볼 사람도 없다.
  // (visibilitychange 가 돌아올 때 즉시 한 번 돈다.)
  if (typeof document !== 'undefined' && document.hidden) {
    schedule()
    return
  }
  try {
    const { count } = await getUnreadCount()
    if (count > state.unreadCount || (count > 0 && !primed)) {
      await announceNewEvents()
    }
    setState({ unreadCount: count })
  } catch {
    // 폴링 실패는 조용히 넘긴다(api 가 silent). 다음 주기에 다시 시도한다.
  } finally {
    primed = true
    schedule()
  }
}

/** 새로 도착한 분석 완료/실패를 토스트·데스크톱 배너로 알린다. */
async function announceNewEvents() {
  const page = await listNotifications({ unread: true, limit: 10 })
  // 오래된 것부터 처리해 배너 순서가 시간 순이 되게 한다.
  for (const item of [...page.items].reverse()) {
    if (announced.has(item.id)) continue
    announced.add(item.id)
    if (!primed) continue // 첫 동기화 — 과거 알림이라 알리지 않는다
    if (item.type === 'ANALYSIS_COMPLETED' || item.type === 'ANALYSIS_FAILED') {
      if (item.resource_id) {
        syncAnalysisOutcome(
          item.resource_id,
          item.type === 'ANALYSIS_COMPLETED' ? 'SUCCEEDED' : 'FAILED',
        )
      } else {
        setState({ hasActiveAnalysis: false })
      }
      announce(item)
    }
  }
}

function announce(item: AppNotification) {
  if (!state.desktopEnabled) return
  showToast(item.title, item.type === 'ANALYSIS_FAILED' ? 'error' : 'success')
  if (!canShowDesktopNotification()) return
  showDesktopNotification({
    title: item.title,
    body: item.content,
    tag: item.id,
    onClick: () => {
      if (item.resource_id) window.location.assign(`/risk-report/${item.resource_id}`)
    },
  })
}

/** 로그인 직후 한 번 — 새로고침으로 진행 중이던 분석을 잊지 않게 한다. */
async function probeActiveAnalysis() {
  try {
    const page = await listAnalyses(null, 1)
    const newest = page.items[0]
    if (newest && !isTerminal(newest.status)) setState({ hasActiveAnalysis: true })
  } catch {
    // 못 알아내면 느린 주기로 폴링할 뿐이다.
  }
}

function startPolling() {
  if (running) return
  running = true
  void probeActiveAnalysis()
  void tick()
}

function stopPolling() {
  running = false
  if (timer !== null) clearTimeout(timer)
  timer = null
}

function onVisibilityChange() {
  if (!running || document.hidden) return
  void tick() // 돌아오자마자 최신 상태를 보여준다
}

/**
 * 폴링을 앱 수명에 묶는 드라이버. **App.tsx 에서 한 번만** 호출한다.
 *
 * 계정이 바뀌면 스토어를 비운다 — 모듈 전역이라 그냥 두면 같은 탭에서 다른 계정으로
 * 로그인했을 때 이전 계정의 개수·알림이 그대로 남는다.
 */
export function useNotificationPolling() {
  const { isAuthed, token } = useAuth()
  const subject = subjectOf(token)

  useEffect(() => {
    if (!isAuthed) {
      reset()
      return
    }
    if (currentUser !== subject) {
      reset()
      currentUser = subject
    }
    startPolling()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopPolling()
    }
  }, [isAuthed, subject])
}

/** 테스트 전용 — 모듈 전역 상태를 초기화한다. */
export function __resetNotificationStoreForTests() {
  reset()
  state = {
    unreadCount: 0,
    hasActiveAnalysis: false,
    analysisOutcomes: {},
    desktopEnabled: true,
  }
  emit()
}
