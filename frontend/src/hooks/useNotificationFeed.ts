import { useCallback, useEffect, useRef, useState } from 'react'

import {
  deleteNotifications,
  listNotifications,
  markNotificationsRead,
} from '../api/notifications'
import type { AppNotification } from '../types/notification'
import { syncUnreadCount } from './useNotifications'

/**
 * 알림 목록 + 커서 무한 스크롤 + 읽음/삭제.
 *
 * 배지(전역 스토어)와 달리 목록은 화면마다 다르므로(드롭다운 5건 / 전용 페이지 30건 + 탭)
 * 훅 로컬 state 로 둔다. 대신 읽음·삭제 후에는 서버가 알려준 안읽음 개수로 배지를 맞춘다.
 *
 * 읽음·삭제는 **낙관적 갱신**이다 — 서버 왕복을 기다리면 목록이 굼떠 보인다. 실패하면
 * 되돌리고 다시 불러온다(오류 모달은 client.ts 가 띄운다).
 */

export type FeedStatus = 'loading' | 'ok' | 'error'

export interface NotificationFeed {
  items: AppNotification[]
  status: FeedStatus
  error: unknown
  hasMore: boolean
  /** 다음 페이지를 불러오는 중인지. 스크롤 센티널이 이걸 보고 중복 호출을 막는다. */
  loadingMore: boolean
  loadMore: () => void
  reload: () => void
  markRead: (ids?: string[]) => Promise<void>
  remove: (ids?: string[]) => Promise<void>
}

export function useNotificationFeed(unreadOnly: boolean, limit = 30): NotificationFeed {
  const [items, setItems] = useState<AppNotification[]>([])
  const [status, setStatus] = useState<FeedStatus>('loading')
  const [error, setError] = useState<unknown>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  // 스크롤 이벤트가 연달아 터져도 같은 페이지를 두 번 받지 않게 하는 가드.
  // state 로는 늦다 — 리렌더 전에 다음 호출이 들어온다.
  const inFlight = useRef(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    inFlight.current = true
    setStatus('loading')
    setError(null)

    listNotifications({ unread: unreadOnly, limit })
      .then((page) => {
        if (cancelled) return
        setItems(page.items)
        setCursor(page.next_cursor)
        setHasMore(page.next_cursor !== null)
        setStatus('ok')
      })
      .catch((caught) => {
        if (cancelled) return
        // 실패를 빈 목록으로 그리면 서버 장애가 "알림 없음"으로 보인다 — 화면이 ErrorState 를 그린다.
        setError(caught)
        setStatus('error')
      })
      .finally(() => {
        inFlight.current = false
      })

    return () => {
      cancelled = true
    }
  }, [unreadOnly, limit, reloadKey])

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  const loadMore = useCallback(() => {
    if (inFlight.current || cursor === null) return
    inFlight.current = true
    setLoadingMore(true)
    listNotifications({ unread: unreadOnly, limit, cursor })
      .then((page) => {
        // 같은 알림이 두 번 들어오지 않게 한 번 더 거른다(경계에서 새 알림이 끼어들 수 있다).
        setItems((prev) => {
          const seen = new Set(prev.map((item) => item.id))
          return [...prev, ...page.items.filter((item) => !seen.has(item.id))]
        })
        setCursor(page.next_cursor)
        setHasMore(page.next_cursor !== null)
      })
      .catch(() => {
        // 추가 로드 실패는 이미 그려진 목록을 지우지 않는다 — 다음 스크롤에 다시 시도한다.
        setHasMore(false)
      })
      .finally(() => {
        inFlight.current = false
        setLoadingMore(false)
      })
  }, [cursor, unreadOnly, limit])

  const markRead = useCallback(
    async (ids?: string[]) => {
      const snapshot = items
      const now = new Date().toISOString()
      const target = ids ? new Set(ids) : null
      const touched = (item: AppNotification) => target === null || target.has(item.id)

      setItems((prev) =>
        unreadOnly
          ? // "읽지 않음" 탭에서는 읽는 순간 조건에서 벗어난다.
            prev.filter((item) => !touched(item))
          : prev.map((item) =>
              touched(item) && item.read_at === null ? { ...item, read_at: now } : item,
            ),
      )
      try {
        const result = await markNotificationsRead(ids)
        syncUnreadCount(result.unread_count)
      } catch {
        setItems(snapshot)
        reload()
      }
    },
    [items, unreadOnly, reload],
  )

  const remove = useCallback(
    async (ids?: string[]) => {
      const snapshot = items
      const target = ids ? new Set(ids) : null
      setItems((prev) => (target === null ? [] : prev.filter((item) => !target.has(item.id))))
      try {
        const result = await deleteNotifications(ids)
        syncUnreadCount(result.unread_count)
        // 전체 삭제 뒤에는 커서가 의미를 잃는다.
        if (target === null) {
          setCursor(null)
          setHasMore(false)
        }
      } catch {
        setItems(snapshot)
        reload()
      }
    },
    [items, reload],
  )

  return { items, status, error, hasMore, loadingMore, loadMore, reload, markRead, remove }
}
