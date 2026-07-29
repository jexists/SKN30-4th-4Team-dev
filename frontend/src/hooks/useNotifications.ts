import { useSyncExternalStore } from 'react'

/**
 * 위험 보고서 생성 알림 — useAvatar 와 같은 모듈 외부 스토어 패턴이다.
 *
 * MyPage 의 "위험 보고서 생성 완료" 토글과 Analyze(진단 실행)·SiteHeader(종 아이콘)가
 * 모두 이 값을 함께 봐야 하므로 어느 한 화면의 로컬 state 로 두지 않는다.
 * 백엔드에 알림 API가 없어 localStorage 로 "다시 확인하기 전까지 유지"를 흉내낸다.
 */
const ENABLED_KEY = 'homeshield.reportAlertsEnabled'
const UNREAD_KEY = 'homeshield.hasUnreadReportAlert'

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : raw === 'true'
  } catch {
    return fallback
  }
}

function writeBool(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value))
  } catch {
    // 저장 실패해도 화면 표시는 유지된다 — 이번 세션 안에서는 문제 없다.
  }
}

let enabled = readBool(ENABLED_KEY, true)
let hasUnread = readBool(UNREAD_KEY, false)
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

/** MyPage 의 "위험 보고서 생성 완료" 토글. */
export function setReportAlertsEnabled(next: boolean) {
  if (enabled === next) return
  enabled = next
  writeBool(ENABLED_KEY, next)
  emit()
}

export function useReportAlertsEnabled() {
  return useSyncExternalStore(
    subscribe,
    () => enabled,
    () => true,
  )
}

/** 컴포넌트 밖(이벤트 핸들러)에서 켜져 있는지만 확인할 때 쓴다. */
export function isReportAlertsEnabled() {
  return enabled
}

/** 진단이 끝나 위험 보고서가 새로 생겼을 때 호출한다. 알림이 꺼져 있으면 아무 일도 없다. */
export function markReportGenerated() {
  if (!enabled || hasUnread) return
  hasUnread = true
  writeBool(UNREAD_KEY, true)
  emit()
}

/** 종 아이콘을 눌러 확인했을 때 호출한다. */
export function clearReportAlert() {
  if (!hasUnread) return
  hasUnread = false
  writeBool(UNREAD_KEY, false)
  emit()
}

export function useHasUnreadReportAlert() {
  return useSyncExternalStore(
    subscribe,
    () => hasUnread,
    () => false,
  )
}
