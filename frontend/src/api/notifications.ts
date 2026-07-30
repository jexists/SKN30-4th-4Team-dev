import type {
  AppNotification,
  NotificationMutation,
  UnreadCount,
} from '../types/notification'
import type { Page } from '../types/api'
import { apiDelete, apiGet, apiPatch } from './client'

const BASE = '/api/v1/notifications'

export interface ListNotificationsOptions {
  cursor?: string | null
  limit?: number
  /** true 면 안읽음만. **서버에서 거른다** — 커서 페이지네이션과 클라이언트 필터를 섞으면 빈 페이지가 생긴다. */
  unread?: boolean
}

export function listNotifications({
  cursor,
  limit = 30,
  unread = false,
}: ListNotificationsOptions = {}): Promise<Page<AppNotification>> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  if (unread) params.set('unread', 'true')
  return apiGet<Page<AppNotification>>(`${BASE}?${params}`)
}

/**
 * 헤더 Badge 용 안읽음 개수.
 *
 * silent 인 이유: 주기적으로 부르는 폴링이라, 네트워크가 잠깐 끊길 때마다 오류 모달이 뜨면
 * 사용자가 하던 일을 방해한다. 실패하면 이전 개수를 유지하고 다음 주기에 다시 시도한다.
 */
export function getUnreadCount(): Promise<UnreadCount> {
  return apiGet<UnreadCount>(`${BASE}/unread-count`, { silent: true })
}

/** ids 를 주면 선택 읽음, 생략하면 전체 읽음. */
export function markNotificationsRead(ids?: string[]): Promise<NotificationMutation> {
  return apiPatch<NotificationMutation>(`${BASE}/read`, { ids: ids ?? null })
}

/** ids 를 주면 선택 삭제, 생략하면 전체 삭제. */
export function deleteNotifications(ids?: string[]): Promise<NotificationMutation> {
  return apiDelete<NotificationMutation>(BASE, { ids: ids ?? null })
}
