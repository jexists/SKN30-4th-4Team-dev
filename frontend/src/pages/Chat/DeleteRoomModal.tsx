import { useCallback, useState } from 'react'

import { deleteRoom, type ChatRoom } from '../../api/chatHistory'
import { Modal } from '../../components/Modal/Modal'
import styles from './Chat.module.scss'

type Props = {
  room: ChatRoom
  onClose: () => void
  onDeleted: (roomId: string) => void
}

export function DeleteRoomModal({ room, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false)

  const handleClose = useCallback(() => {
    if (!deleting) onClose()
  }, [deleting, onClose])

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteRoom(room.id)
      onDeleted(room.id)
    } catch {
      // 원인은 공통 오류 모달이 알린다. 모달은 열어 둔 채 다시 시도할 수 있게 한다.
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal open title="대화 삭제" onClose={handleClose}>
      <div className={styles.roomForm}>
        <p className={styles.confirmText}>
          대화를 삭제하시겠습니까?
          <span>삭제된 대화는 복구할 수 없습니다.</span>
        </p>
        <div className={styles.roomFormActions}>
          <button
            type="button"
            className={styles.roomFormCancel}
            disabled={deleting}
            onClick={handleClose}
          >
            취소
          </button>
          <button
            type="button"
            className={styles.roomFormDanger}
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
