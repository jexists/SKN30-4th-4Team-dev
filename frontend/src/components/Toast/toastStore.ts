import { useSyncExternalStore } from 'react'

/**
 * 토스트 알림 스토어.
 *
 * useAuth 와 같은 모듈 외부 스토어 패턴이라 컴포넌트 밖에서도 `showToast(...)` 로
 * 알림을 띄울 수 있다. 화면에는 App 에 한 번 렌더한 <Toaster /> 가 그려준다.
 */
export type ToastType = 'error' | 'success' | 'info'
export type Toast = { id: number; message: string; type: ToastType }

/** 자동으로 사라지기까지의 시간(ms). */
const AUTO_DISMISS_MS = 4000

let toasts: Toast[] = []
let nextId = 1
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

/** 어디서든 호출 가능한 토스트 표시 함수. 일정 시간 뒤 자동으로 닫힌다. */
export function showToast(message: string, type: ToastType = 'info') {
  const id = nextId++
  toasts = [...toasts, { id, message, type }]
  emit()
  if (typeof window !== 'undefined') {
    window.setTimeout(() => dismissToast(id), AUTO_DISMISS_MS)
  }
  return id
}

export function dismissToast(id: number) {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

/** 현재 떠 있는 토스트 목록. <Toaster /> 가 구독한다. */
export function useToasts() {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  )
}
