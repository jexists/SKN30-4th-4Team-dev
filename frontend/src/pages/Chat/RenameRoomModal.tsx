import { useCallback, useRef, useState, type FormEvent } from 'react'

import { ROOM_TITLE_MAX, updateRoomTitle, type ChatRoom } from '../../api/chatHistory'
import { Modal } from '../../components/Modal/Modal'
import styles from './Chat.module.scss'

type Props = {
  room: ChatRoom
  onClose: () => void
  onSaved: (room: ChatRoom) => void
}

export function RenameRoomModal({ room, onClose, onSaved }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(room.title ?? '')
  const [saving, setSaving] = useState(false)

  const handleClose = useCallback(() => {
    if (!saving) onClose()
  }, [onClose, saving])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || saving) return

    setSaving(true)
    try {
      onSaved(await updateRoomTitle(room.id, trimmed))
    } catch {
      // 원인은 공통 오류 모달이 알린다. 여기선 저장 상태만 풀고 모달을 열어 두어
      // 사용자가 입력한 제목 그대로 다시 시도할 수 있게 한다.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title="대화 제목 수정"
      onClose={handleClose}
      initialFocusRef={inputRef}
    >
      <form className={styles.roomForm} onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="room-title">대화 제목</label>
        <input
          id="room-title"
          ref={inputRef}
          className={styles.roomFormInput}
          defaultValue={room.title ?? ''}
          maxLength={ROOM_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className={styles.roomFormActions}>
          <button
            type="button"
            className={styles.roomFormCancel}
            disabled={saving}
            onClick={handleClose}
          >
            취소
          </button>
          <button
            type="submit"
            className={styles.roomFormSubmit}
            disabled={saving || !title.trim()}
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
