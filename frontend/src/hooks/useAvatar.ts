import { useSyncExternalStore } from 'react'

/**
 * 프로필 사진 미리보기 — 아직 저장할 백엔드 API가 없어 브라우저에만 남긴다.
 *
 * toastStore·useAuth 와 같은 모듈 외부 스토어 패턴이다. MyPage(사진 변경 화면)와
 * SiteHeader(우측 상단 아바타)가 이 값을 함께 구독해야 하므로 어느 한쪽의 로컬
 * state 로 두지 않고 여기서 공유한다.
 *
 * object URL(`URL.createObjectURL`)이 아니라 data URL(base64)로 저장하는 이유 —
 * object URL 은 새로고침하면 즉시 무효화되지만, localStorage 에 넣어둔 data URL 은
 * "다시 바꾸기 전까지" 새로고침·재방문에도 그대로 남는다.
 */
const STORAGE_KEY = 'homeshield.avatarDataUrl'

function readInitial(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

let avatarUrl: string | null = readInitial()
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

function getSnapshot() {
  return avatarUrl
}

function getServerSnapshot() {
  return null
}

function setAvatarUrl(next: string | null) {
  if (avatarUrl === next) return
  avatarUrl = next
  try {
    if (next) window.localStorage.setItem(STORAGE_KEY, next)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 저장 용량 초과 등은 무시한다 — 화면에 반영되는 것만으로 충분한 로컬 목업 기능이다.
  }
  emit()
}

/** 선택한 파일을 data URL 로 읽어 저장한다. */
export function setAvatarFile(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    if (typeof reader.result === 'string') setAvatarUrl(reader.result)
  }
  reader.readAsDataURL(file)
}

export function useAvatarUrl() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
