import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { useIsMobile } from '../../hooks/useMediaQuery'
import { useNotificationFeed } from '../../hooks/useNotificationFeed'
import { useHasActiveAnalysis, useUnreadCount } from '../../hooks/useNotifications'
import type { AppNotification } from '../../types/notification'
import { isRead } from '../../types/notification'
import { ErrorState } from '../ErrorState/ErrorState'
import { ArrowRight, Bell } from '../icons'
import { notificationLink } from './notificationLink'
import { relativeTime } from './relativeTime'
import styles from './NotificationBell.module.scss'

/**
 * 헤더의 종 아이콘 — 안읽음 배지 + 최근 알림 드롭다운.
 *
 * 드롭다운 동작(바깥 클릭·ESC·aria-expanded)은 같은 헤더의 UserMenu 와 같은 패턴을 따른다.
 * 목록은 **열 때만** 불러온다 — 안 열어볼 사용자를 위해 매번 30건을 받을 이유가 없다.
 * 배지 숫자는 별개로 전역 스토어가 폴링으로 유지한다.
 */

/** 드롭다운은 미리보기다. 더 보려면 전용 페이지로 간다. */
const PREVIEW_COUNT = 5

export function NotificationBell() {
  const navigate = useNavigate()
  const unreadCount = useUnreadCount()
  const hasActiveAnalysis = useHasActiveAnalysis()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // 99 를 넘으면 자릿수가 늘어 배지가 아이콘을 밀어낸다.
  const badge = unreadCount > 99 ? '99+' : String(unreadCount)
  const label = unreadCount > 0 ? `알림 ${unreadCount}개 읽지 않음` : '알림'

  function handleClick() {
    // 좁은 화면에서 드롭다운은 페이지보다 나쁘다 — 곧장 전용 페이지로 보낸다.
    if (isMobile) {
      void navigate('/notifications')
      return
    }
    setOpen((prev) => !prev)
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={hasActiveAnalysis ? `${styles.bellBtn} ${styles.pulsing}` : styles.bellBtn}
        aria-label={label}
        aria-haspopup={isMobile ? undefined : 'menu'}
        aria-expanded={isMobile ? undefined : open}
        onClick={handleClick}
      >
        <Bell />
        {unreadCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {badge}
          </span>
        )}
      </button>

      {open && <NotificationPanel onClose={() => setOpen(false)} />}
    </div>
  )
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { items, status, markRead } = useNotificationFeed(false, PREVIEW_COUNT)
  const hasUnread = items.some((item) => !isRead(item))

  function handleOpenItem(item: AppNotification, link: string) {
    onClose()
    void markRead([item.id])
    void navigate(link)
  }

  return (
    <div className={styles.panel} role="menu" aria-label="알림">
      <div className={styles.panelHead}>
        <span className={styles.panelTitle}>알림</span>
        {hasUnread && (
          <button type="button" className={styles.panelAction} onClick={() => void markRead()}>
            모두 읽음
          </button>
        )}
      </div>

      <div className={styles.panelBody}>
        {status === 'loading' && (
          <p className={styles.panelNote} role="status">
            불러오는 중입니다.
          </p>
        )}
        {status === 'error' && <ErrorState message="알림을 불러오지 못했습니다." />}
        {status === 'ok' &&
          (items.length === 0 ? (
            <p className={styles.panelNote}>아직 받은 알림이 없습니다.</p>
          ) : (
            items.map((item) => (
              <PreviewRow key={item.id} item={item} onOpen={handleOpenItem} />
            ))
          ))}
      </div>

      <Link to="/notifications" className={styles.panelFooter} onClick={onClose}>
        전체 보기
      </Link>
    </div>
  )
}

/**
 * 이동할 곳이 있으면 버튼, 없으면 그냥 div 로 그린다.
 *
 * 눌렀는데 아무 일도 안 일어나는 행은 고장처럼 보인다 — 애초에 누를 수 있어 보이지 않게 한다.
 * 판정은 notificationLink() 한 곳에서만 한다.
 */
function PreviewRow({
  item,
  onOpen,
}: {
  item: AppNotification
  onOpen: (item: AppNotification, link: string) => void
}) {
  const link = notificationLink(item)
  const unread = !isRead(item)
  const className = unread ? `${styles.row} ${styles.rowUnread}` : styles.row

  const body = (
    <>
      {unread && <span className={styles.dot} aria-hidden="true" />}
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowContent}>{item.content}</span>
      </span>
      <span className={styles.rowTime}>{relativeTime(item.created_at)}</span>
    </>
  )

  if (!link) {
    return <div className={className}>{body}</div>
  }

  return (
    <button
      type="button"
      role="menuitem"
      className={`${className} ${styles.rowLink}`}
      onClick={() => onOpen(item, link)}
    >
      {body}
      <ArrowRight className={styles.rowArrow} />
    </button>
  )
}
