import { memo, useEffect, useRef, useState } from 'react'

import type { ChatRoom } from '../../api/chatHistory'
import { Edit, MoreVertical, Trash } from '../../components/icons'
import styles from './Chat.module.scss'

type Props = {
  room: ChatRoom
  active: boolean
  onOpen: (roomId: string) => void
  onRename: (room: ChatRoom) => void
  onDelete: (room: ChatRoom) => void
}

/** 목록 한 줄의 메뉴 상태를 항목 안에 가둬 다른 방까지 다시 렌더하지 않는다. */
export const ChatRoomItem = memo(function ChatRoomItem({
  room,
  active,
  onOpen,
  onRename,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rootRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!menuOpen) return

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const title = room.title || '새 대화'

  return (
    <li className={styles.historyRow} ref={rootRef}>
      <button
        type="button"
        className={`${styles.historyItem} ${active ? styles.historyActive : ''}`}
        aria-current={active ? 'true' : undefined}
        onClick={() => onOpen(room.id)}
      >
        <span className={styles.historyTitle}>{title}</span>
      </button>

      <button
        type="button"
        className={`${styles.roomMenuTrigger} ${
          menuOpen ? styles.roomMenuTriggerOpen : ''
        }`}
        aria-label="대화 옵션"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((prev) => !prev)}
      >
        <MoreVertical />
      </button>

      {menuOpen && (
        <div className={styles.menu} role="menu">
          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => {
              setMenuOpen(false)
              onRename(room)
            }}
          >
            <Edit />
            제목 수정
          </button>
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => {
              setMenuOpen(false)
              onDelete(room)
            }}
          >
            <Trash />
            삭제
          </button>
        </div>
      )}
    </li>
  )
})
