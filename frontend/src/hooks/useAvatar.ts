import { useSyncExternalStore } from 'react'

/**
 * 프로필 사진 미리보기 URL — 아직 저장할 백엔드 API가 없어 클라이언트 메모리에만 둔다.
 *
 * toastStore·useAuth 와 같은 모듈 외부 스토어 패턴이다. MyPage(사진 변경 화면)와
 * SiteHeader(우측 상단 아바타)가 이 값을 함께 구독해야 하므로 어느 한쪽의 로컬
 * state 로 두지 않고 여기서 공유한다.
 */
let avatarUrl: string | null = null
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

/** 새 미리보기로 교체한다. 이전 object URL 은 더 쓰이지 않으므로 여기서 바로 해제한다. */
export function setAvatarUrl(next: string | null) {
  if (avatarUrl === next) return
  const prev = avatarUrl
  avatarUrl = next
  emit()
  if (prev) URL.revokeObjectURL(prev)
}

export function useAvatarUrl() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
