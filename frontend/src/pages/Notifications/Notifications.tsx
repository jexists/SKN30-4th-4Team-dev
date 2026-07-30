import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { ErrorState } from '../../components/ErrorState/ErrorState'
import { Modal } from '../../components/Modal/Modal'
import { notificationLink } from '../../components/NotificationBell/notificationLink'
import { relativeTime } from '../../components/NotificationBell/relativeTime'
import { ArrowRight, Bell, Check, Warn } from '../../components/icons'
import { useNotificationFeed } from '../../hooks/useNotificationFeed'
import { useUnreadCount } from '../../hooks/useNotifications'
import type { AppNotification, NotificationType } from '../../types/notification'
import { isRead } from '../../types/notification'
import styles from './Notifications.module.scss'

/**
 * 알림 전용 화면 — 목록·무한 스크롤·선택 읽음/삭제.
 *
 * 탭 상태를 로컬 state 가 아니라 **URL 쿼리(`?tab=unread`)** 에 둔다. 뒤로가기가 자연스럽고
 * 새로고침해도 유지되며, 링크로 공유할 수도 있다.
 *
 * "전체 읽음"·"전체 삭제"는 **선택과 무관하게 서버에서 전량 처리**한다(`ids=null`). 화면에
 * 로드된 30건만 지워지는 혼란을 만들지 않기 위해서이고, 확인 모달 문구가 그 범위를 밝힌다.
 */

const PAGE_SIZE = 30

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  GENERAL: Bell,
  WELCOME: Check,
  ANALYSIS_STARTED: Bell,
  ANALYSIS_COMPLETED: Check,
  ANALYSIS_FAILED: Warn,
}

type ConfirmTarget = { scope: 'all' } | { scope: 'selected'; ids: string[] }

export function Notifications() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const unreadOnly = searchParams.get('tab') === 'unread'
  const unreadCount = useUnreadCount()

  const feed = useNotificationFeed(unreadOnly, PAGE_SIZE)
  const { items, status, hasMore, loadingMore, loadMore, reload, markRead, remove } = feed

  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [confirm, setConfirm] = useState<ConfirmTarget | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 탭이 바뀌면 목록이 통째로 달라진다 — 보이지 않는 항목이 선택된 채 남지 않게 비운다.
  useEffect(() => {
    setSelected(new Set())
  }, [unreadOnly])

  const setTab = useCallback(
    (next: 'all' | 'unread') => {
      // replace: 탭을 왔다갔다 한 만큼 뒤로가기를 눌러야 하면 성가시다.
      setSearchParams(next === 'unread' ? { tab: 'unread' } : {}, { replace: true })
    },
    [setSearchParams],
  )

  const loadedIds = useMemo(() => items.map((item) => item.id), [items])
  const allLoadedSelected = loadedIds.length > 0 && loadedIds.every((id) => selected.has(id))
  const selectedIds = useMemo(
    // 선택은 무한 스크롤 중에도 유지되지만, 삭제된 항목이 남을 수 있어 현재 목록으로 거른다.
    () => loadedIds.filter((id) => selected.has(id)),
    [loadedIds, selected],
  )

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAllLoaded() {
    setSelected(allLoadedSelected ? new Set() : new Set(loadedIds))
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
  }

  function handleOpen(item: AppNotification, link: string) {
    void markRead([item.id])
    void navigate(link)
  }

  async function handleConfirmDelete() {
    if (!confirm || deleting) return
    setDeleting(true)
    try {
      await remove(confirm.scope === 'all' ? undefined : confirm.ids)
      setConfirm(null)
      exitSelectMode()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.head}>
          <h1 className={styles.title}>알림</h1>
          <div className={styles.headActions}>
            {selectMode ? (
              <button type="button" className={styles.linkBtn} onClick={exitSelectMode}>
                선택 취소
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => setSelectMode(true)}
                  disabled={items.length === 0}
                >
                  선택
                </button>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => void markRead()}
                  disabled={unreadCount === 0}
                >
                  모두 읽음
                </button>
                <button
                  type="button"
                  className={`${styles.linkBtn} ${styles.linkDanger}`}
                  onClick={() => setConfirm({ scope: 'all' })}
                  disabled={items.length === 0}
                >
                  전체 삭제
                </button>
              </>
            )}
          </div>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="알림 필터">
          <Tab selected={!unreadOnly} onSelect={() => setTab('all')} controls="notification-list">
            전체
          </Tab>
          <Tab selected={unreadOnly} onSelect={() => setTab('unread')} controls="notification-list">
            읽지 않음{unreadCount > 0 ? ` (${unreadCount})` : ''}
          </Tab>
        </div>

        {selectMode && items.length > 0 && (
          <label className={styles.selectAll}>
            <input type="checkbox" checked={allLoadedSelected} onChange={toggleAllLoaded} />
            <span>불러온 알림 전체 선택</span>
          </label>
        )}

        <div id="notification-list" role="tabpanel" className={styles.list}>
          {status === 'loading' && <ListSkeleton />}

          {status === 'error' && (
            <ErrorState message="알림을 불러오지 못했습니다." onRetry={reload} />
          )}

          {status === 'ok' && items.length === 0 && (
            <div className={styles.empty}>
              <Bell className={styles.emptyIcon} />
              <p className={styles.emptyTitle}>
                {unreadOnly ? '읽지 않은 알림이 없습니다.' : '아직 받은 알림이 없습니다.'}
              </p>
              {!unreadOnly && (
                <p className={styles.emptyDesc}>새로운 알림이 도착하면 이곳에 표시됩니다.</p>
              )}
            </div>
          )}

          {status === 'ok' &&
            items.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                selectMode={selectMode}
                selected={selected.has(item.id)}
                onToggle={() => toggleSelected(item.id)}
                onOpen={handleOpen}
              />
            ))}

          {status === 'ok' && items.length > 0 && (
            <ScrollSentinel hasMore={hasMore} loading={loadingMore} onLoadMore={loadMore} />
          )}
        </div>
      </div>

      {selectMode && (
        <div className={styles.actionBar} role="toolbar" aria-label="선택한 알림 작업">
          <span className={styles.actionCount}>{selectedIds.length}개 선택</span>
          <button
            type="button"
            className={styles.actionBtn}
            disabled={selectedIds.length === 0}
            onClick={() => {
              void markRead(selectedIds)
              exitSelectMode()
            }}
          >
            읽음
          </button>
          <button
            type="button"
            className={`${styles.actionBtn} ${styles.actionDanger}`}
            disabled={selectedIds.length === 0}
            onClick={() => setConfirm({ scope: 'selected', ids: selectedIds })}
          >
            삭제
          </button>
          <button type="button" className={styles.actionBtn} onClick={exitSelectMode}>
            취소
          </button>
        </div>
      )}

      <Modal
        open={confirm !== null}
        // 처리 중에는 닫히지 않게 한다 — 진행 중인 요청을 두고 화면이 사라지면 결과를 알 수 없다.
        onClose={() => !deleting && setConfirm(null)}
        title="알림 삭제"
      >
        <div className={styles.confirmBody}>
          <p className={styles.confirmQuestion}>
            {confirm?.scope === 'selected'
              ? `선택한 알림 ${confirm.ids.length}개를 삭제하시겠습니까?`
              : '모든 알림을 삭제하시겠습니까?'}
          </p>
          <p className={styles.confirmWarning}>
            {confirm?.scope === 'all'
              ? '읽지 않음 탭에 보이지 않는 알림까지 모두 삭제되며, 되돌릴 수 없습니다.'
              : '삭제한 알림은 되돌릴 수 없습니다.'}
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.btnGhost}
              disabled={deleting}
              onClick={() => setConfirm(null)}
            >
              취소
            </button>
            <button
              type="button"
              className={styles.btnDanger}
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {deleting ? '삭제 중...' : '삭제'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ── 부품 ───────────────────────────────────────────────────────────────

/** 좌우 화살표로 이동하는 탭. 공용 Tabs 컴포넌트는 아직 이 화면에만 필요해 페이지 로컬로 둔다. */
function Tab({
  selected,
  onSelect,
  controls,
  children,
}: {
  selected: boolean
  onSelect: () => void
  controls: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={controls}
      tabIndex={selected ? 0 : -1}
      className={selected ? `${styles.tab} ${styles.tabActive}` : styles.tab}
      onClick={onSelect}
      onKeyDown={(e) => {
        // 탭 목록이 둘뿐이라 좌우 어느 쪽이든 반대 탭으로 간다.
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      {children}
    </button>
  )
}

function NotificationRow({
  item,
  selectMode,
  selected,
  onToggle,
  onOpen,
}: {
  item: AppNotification
  selectMode: boolean
  selected: boolean
  onToggle: () => void
  onOpen: (item: AppNotification, link: string) => void
}) {
  const link = notificationLink(item)
  const unread = !isRead(item)
  const Icon = TYPE_ICON[item.type] ?? Bell

  const body = (
    <>
      <span className={`${styles.rowIcon} ${unread ? styles.rowIconUnread : ''}`}>
        <Icon />
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{item.title}</span>
        <span className={styles.rowContent}>{item.content}</span>
      </span>
      <span className={styles.rowTime}>{relativeTime(item.created_at)}</span>
      {link && <ArrowRight className={styles.rowArrow} />}
    </>
  )

  const className = [styles.row, unread ? styles.rowUnread : '', link ? styles.rowLink : '']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={styles.rowWrap}>
      {selectMode && (
        // 체크박스를 행 클릭 영역 밖에 두어 오터치로 이동해버리는 일을 막는다.
        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`${item.title} 선택`}
          />
        </label>
      )}
      {link && !selectMode ? (
        <button type="button" className={className} onClick={() => onOpen(item, link)}>
          {body}
        </button>
      ) : (
        // 갈 곳이 없거나 선택 모드일 때는 누를 수 있어 보이지 않게 그냥 div 로 그린다.
        <div className={styles.row + (unread ? ` ${styles.rowUnread}` : '')}>{body}</div>
      )}
    </div>
  )
}

/**
 * 바닥에 닿으면 다음 페이지를 부르는 센티널 — Chat 의 무한 스크롤과 같은 패턴이다.
 * 더 없으면 observer 를 아예 붙이지 않아 마지막에 헛 요청이 나가지 않는다.
 */
function ScrollSentinel({
  hasMore,
  loading,
  onLoadMore,
}: {
  hasMore: boolean
  loading: boolean
  onLoadMore: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasMore) return
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) onLoadMore()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasMore, onLoadMore])

  if (!hasMore) {
    return <p className={styles.listEnd}>모든 알림을 확인했습니다.</p>
  }

  return (
    <div ref={ref} className={styles.sentinel}>
      {loading && (
        <p className={styles.listEnd} role="status">
          불러오는 중입니다.
        </p>
      )}
    </div>
  )
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="알림을 불러오는 중입니다.">
      {[0, 1, 2].map((index) => (
        <div key={index} className={styles.skeletonRow}>
          <span className={styles.skeletonIcon} />
          <span className={styles.skeletonText}>
            <span className={styles.skeletonLine} />
            <span className={`${styles.skeletonLine} ${styles.skeletonLineShort}`} />
          </span>
        </div>
      ))}
    </div>
  )
}
