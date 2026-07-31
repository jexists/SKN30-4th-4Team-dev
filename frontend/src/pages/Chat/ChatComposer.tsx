import { useLayoutEffect, useRef } from 'react'

import { FileLines, Info, Paperclip, Send } from '../../components/icons'
import { ACCEPT_ATTR } from '../../utils/uploadFiles'
import { AttachmentList } from './AttachmentList'
import styles from './Chat.module.scss'
import type { PendingFile, RoomAttachment } from './types'

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** 전송 중(중복 전송 방지). */
  disabled: boolean
  /**
   * 잠긴 이유(있을 때만). 이유 없이 죽어 있는 입력창은 고장으로 보인다.
   * 별도 줄이 아니라 플레이스홀더 자리를 빌려 쓴다 — 나타났다 사라지며 입력창을 밀지 않게.
   */
  notice?: string
  maxLength: number
  /** 아직 보내지 않은 첨부파일. 전송할 때 함께 올라간다. */
  pendingFiles: PendingFile[]
  onPickFiles: (files: File[]) => void
  onRemovePendingFile: (key: string) => void
  /** 이 대화가 지금 참고 중인 계약서. 없으면 배지를 그리지 않는다. */
  roomAttachment?: RoomAttachment | null
  onDetachRoomDocument: () => void
}

const PLACEHOLDER = '법률적인 상황을 설명해주세요...'
const MAX_HEIGHT = 200 // px — 이 높이까지 늘고 그 뒤엔 내부 스크롤

/**
 * 하단 고정 입력창. Enter 전송 / Shift+Enter 줄바꿈, 내용이 길어지면 높이만 증가(상한 후 내부 스크롤),
 * 전송 중엔 비활성.
 *
 * 첨부는 두 층이다 — 입력창 위 **프리뷰**(아직 안 보낸 파일, ✕ 로 뺄 수 있다)와 그 위
 * **참고 중 배지**(이 대화가 읽고 있는 계약서). 파일을 고르는 것만으로는 아무것도 업로드하지
 * 않는다. 전송해야 올라가고, 그래야 ✕ 가 취소할 대상이 분명해진다.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  notice,
  maxLength,
  pendingFiles,
  onPickFiles,
  onRemovePendingFile,
  roomAttachment,
  onDetachRoomDocument,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 내용에 맞춰 높이 자동 조절(레이아웃은 안 밀리게 상한 적용).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  // 첨부만 두고 보내는 것도 뜻이 분명한 요청이다("이거 봐줘") — 이때 무엇을 물었는지는
  // Chat 이 기본 문구로 채운다. 빈 문자열은 서버가 422 로 막는다.
  const canSubmit = Boolean(value.trim()) || pendingFiles.length > 0

  function submit() {
    if (!disabled && canSubmit) onSubmit()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function pickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    // 같은 파일을 다시 골라도 change 가 오도록 값을 비운다(뺐다가 다시 담는 경우).
    e.target.value = ''
    if (files.length > 0) onPickFiles(files)
  }

  return (
    <div className={styles.composer}>
      {roomAttachment && roomAttachment.fileNames.length > 0 && (
        <div className={styles.roomDoc} role="status">
          <FileLines className={styles.roomDocIcon} />
          <span className={styles.roomDocText}>
            {roomAttachment.fileNames[0]}
            {roomAttachment.fileNames.length > 1 &&
              ` 외 ${roomAttachment.fileNames.length - 1}개`}{' '}
            참고 중
          </span>
          <button
            type="button"
            className={styles.roomDocRemove}
            aria-label="참고 중인 계약서 해제"
            onClick={onDetachRoomDocument}
          >
            해제
          </button>
        </div>
      )}

      <AttachmentList
        items={pendingFiles.map((f) => ({
          key: f.key,
          name: f.file.name,
          kind: f.kind,
          previewUrl: f.previewUrl,
        }))}
        variant="composer"
        onRemove={onRemovePendingFile}
      />

      <form
        className={styles.inputBar}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          ref={fileRef}
          type="file"
          className={styles.fileInput}
          accept={ACCEPT_ATTR}
          multiple
          onChange={pickFiles}
          tabIndex={-1}
          aria-hidden="true"
        />
        <button
          type="button"
          className={styles.attachBtn}
          aria-label="파일 첨부"
          title="파일 첨부 (PDF·PNG·JPG)"
          // 전송 중에만 잠근다 — 고르는 것 자체는 업로드가 아니라서 막을 이유가 없다.
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip />
        </button>
        <textarea
          ref={ref}
          className={styles.input}
          placeholder={notice ?? PLACEHOLDER}
          value={value}
          maxLength={maxLength}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          className={styles.sendBtn}
          aria-label="전송"
          // 이미 초안을 써둬 플레이스홀더가 가려진 경우에도 이유를 확인할 수 있게.
          title={notice}
          disabled={disabled || !canSubmit}
        >
          <Send />
        </button>
      </form>
      <div className={styles.composerNote}>
        <span className={styles.composerDisclaimer}>
          <Info className={styles.composerDisclaimerIcon} />
          AI 답변은 법률 자문을 대신하지 않습니다.
        </span>
        <span className={styles.counter}>
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  )
}
