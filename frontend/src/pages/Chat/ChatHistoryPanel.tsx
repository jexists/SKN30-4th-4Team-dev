import type { ChatRoom } from '../../api/chatHistory'
import { isRetryable } from '../../api/apiErrorHandler'
import { ErrorState } from '../../components/ErrorState/ErrorState'
import { Chat as ChatIcon } from '../../components/icons'
import { ChatRoomItem } from './ChatRoomItem'
import type { RoomGroup } from './roomGroups'
import styles from './Chat.module.scss'

type Props = {
  /** 데스크탑 사이드바인지 모바일 드로어인지 — 상단 헤더 한 줄만 달라진다. */
  variant: 'sidebar' | 'drawer'
  /** 로그인 + 저장소 설정 여부. false 면 목록 대신 안내만 보여준다. */
  persistent: boolean
  groups: RoomGroup[]
  /** 성공했는데 0건인지. 실패는 roomsError 가 이긴다. */
  isEmpty: boolean
  roomsError: unknown
  /** 다음 페이지가 남아 있는지 — 무한스크롤 sentinel 을 그릴지 정한다. */
  hasMoreRooms: boolean
  activeRoomId: string | null
  pendingRooms: ReadonlySet<string>
  /** 무한스크롤 IntersectionObserver 의 root 가 되는 스크롤 컨테이너. */
  scrollRef: React.RefObject<HTMLDivElement | null>
  sentinelRef: React.RefObject<HTMLDivElement | null>
  onNewChat: () => void
  onOpenRoom: (roomId: string) => void
  onRenameRoom: (room: ChatRoom) => void
  onDeleteRoom: (room: ChatRoom) => void
  onRetryRooms: () => void
  /** 목록 아래 고정 영역 — 추천 주제(ChatSuggestTopics). */
  footer?: React.ReactNode
}

/**
 * 대화 기록 목록 — **데스크탑 사이드바와 모바일 드로어가 같은 컴포넌트를 쓴다.**
 *
 * 날짜 그룹핑·항목·빈 상태·오류·무한스크롤이 전부 여기 있으므로 두 레이아웃이 갈라질 일이
 * 없다. variant 는 상단 헤더 한 줄에만 영향을 준다 — 드로어는 제목을 Drawer 헤더가
 * 이미 그리고 있어 여기서 또 그리면 제목이 두 번 나온다.
 */
export function ChatHistoryPanel({
  variant,
  persistent,
  groups,
  isEmpty,
  roomsError,
  hasMoreRooms,
  activeRoomId,
  pendingRooms,
  scrollRef,
  sentinelRef,
  onNewChat,
  onOpenRoom,
  onRenameRoom,
  onDeleteRoom,
  onRetryRooms,
  footer,
}: Props) {
  const isDrawer = variant === 'drawer'

  return (
    <>
      <div className={styles.sidebarTop} ref={scrollRef}>
        <div className={`${styles.sideHead} ${isDrawer ? styles.sideHeadDrawer : ''}`}>
          {!isDrawer && <h2 className={styles.sideTitle}>대화 기록</h2>}
          {persistent && (
            <button
              type="button"
              className={`${styles.newChat} ${isDrawer ? styles.newChatBlock : ''}`}
              onClick={onNewChat}
            >
              + 새 대화
            </button>
          )}
        </div>

        {!persistent ? (
          <p className={styles.sideEmpty}>로그인하면 대화가 저장되어 언제든 다시 볼 수 있어요.</p>
        ) : (
          <>
            {groups.map((group) => (
              <div key={group.label} className={styles.historyGroup}>
                <h3 className={styles.historyGroupLabel}>{group.label}</h3>
                <ul className={styles.historyList}>
                  {group.rooms.map((room) => (
                    <ChatRoomItem
                      key={room.id}
                      room={room}
                      active={activeRoomId === room.id}
                      generating={pendingRooms.has(room.id)}
                      onOpen={onOpenRoom}
                      onRename={onRenameRoom}
                      onDelete={onDeleteRoom}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {/* 무한스크롤 감시 지점은 날짜 그룹 목록과 분리해 유효한 마크업을 유지한다. */}
            {hasMoreRooms && <div ref={sentinelRef} className={styles.roomsSentinel} />}

            {/* 실패가 Empty State 를 이긴다 — 서버 장애를 "대화가 없다" 로 보여주면 안 된다. */}
            {roomsError !== null ? (
              <ErrorState
                message="대화 기록을 불러오지 못했습니다."
                onRetry={isRetryable(roomsError) ? onRetryRooms : undefined}
              />
            ) : isEmpty ? (
              // 목록은 최대한 조용하게 — 안내는 가운데 Hero 가 이미 하고 있다.
              <div className={styles.roomsEmpty}>
                <ChatIcon className={styles.roomsEmptyIcon} />
                <p className={styles.roomsEmptyText}>대화가 없습니다.</p>
              </div>
            ) : null}
          </>
        )}
      </div>

      {footer}
    </>
  )
}
