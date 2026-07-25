import { useSyncExternalStore } from 'react'

/**
 * 오류 모달 스토어.
 *
 * toastStore 와 같은 모듈 외부 스토어 패턴이라 컴포넌트 밖에서도 `showError(...)` 로 오류를
 * 띄울 수 있다. 화면에는 App 에 한 번 렌더한 <ErrorModalHost /> 가 그려준다.
 * 한 번에 하나만 보여준다(가장 마지막 오류로 덮어쓴다).
 */
export interface AppErrorInfo {
  /** 모달 제목 (서버 error.title). */
  title: string
  /** 모달 본문 (서버 error.message). 비어 있으면 제목만 보여준다. */
  message: string
}

let current: AppErrorInfo | null = null
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

/**
 * 어디서든 호출 가능한 오류 모달 표시 함수.
 *
 * 재시도는 실패한 영역의 <ErrorState /> 가 맡는다 — 여기서는 화면 상태를 어떻게 되돌릴지
 * 알 수 없고, 모달을 닫으면 재시도 수단도 함께 사라지기 때문이다.
 */
export function showError(title: string, message: string) {
  current = { title, message }
  emit()
}

export function dismissError() {
  if (current === null) return
  current = null
  emit()
}

/** 현재 표시할 오류(없으면 null). <ErrorModalHost /> 가 구독한다. */
export function useAppError(): AppErrorInfo | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  )
}
