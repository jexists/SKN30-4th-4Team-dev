import { useLayoutEffect, useRef } from 'react'

import { Close, FileLines, Info, Paperclip, Send, Warn } from '../../components/icons'
import styles from './Chat.module.scss'
import type { Attachment } from './types'

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
  /** 이 대화에 첨부된 계약서. 없으면 칩을 그리지 않는다. */
  attachment?: Attachment | null
  onAttach: (file: File) => void
  onRemoveAttachment: () => void
}

const PLACEHOLDER = '법률적인 상황을 설명해주세요...'
const MAX_HEIGHT = 200 // px — 이 높이까지 늘고 그 뒤엔 내부 스크롤
/** 백엔드 업로드 검증(analysis.py)과 같은 목록. 여기서 먼저 걸러 헛왕복을 줄인다. */
const ACCEPT = '.pdf,.png,.jpg,.jpeg'

const STATE_TEXT: Record<Attachment['state'], string> = {
  PREPARING: '올리는 중…',
  PROCESSING: '계약서를 읽는 중…',
  READY: '이 대화에서 참고 중',
  FAILED: '첨부 실패',
}

/**
 * 하단 고정 입력창. Enter 전송 / Shift+Enter 줄바꿈, 내용이 길어지면 높이만 증가(상한 후 내부 스크롤),
 * 전송 중엔 비활성. 첨부한 계약서는 입력창 위 칩으로 상태를 보여준다.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  notice,
  maxLength,
  attachment,
  onAttach,
  onRemoveAttachment,
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

  function submit() {
    if (!disabled && value.trim()) onSubmit()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 같은 파일을 다시 골라도 change 가 오도록 값을 비운다(첨부 실패 후 재시도).
    e.target.value = ''
    if (file) onAttach(file)
  }

  // 처리 중에는 새 파일을 받지 않는다 — 회원당 진행 중 분석이 1건이라 어차피 거절된다.
  const busy = attachment?.state === 'PREPARING' || attachment?.state === 'PROCESSING'
  const failed = attachment?.state === 'FAILED'

  return (
    <div className={styles.composer}>
      {attachment && (
        <div
          className={`${styles.attachment} ${failed ? styles.attachmentFailed : ''}`}
          role="status"
        >
          {failed ? (
            <Warn className={styles.attachmentIcon} />
          ) : (
            <FileLines className={styles.attachmentIcon} />
          )}
          <span className={styles.attachmentName}>{attachment.fileName}</span>
          <span className={styles.attachmentState}>
            {attachment.message ?? STATE_TEXT[attachment.state]}
          </span>
          <button
            type="button"
            className={styles.attachmentRemove}
            aria-label="첨부 해제"
            onClick={onRemoveAttachment}
          >
            <Close />
          </button>
        </div>
      )}

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
          accept={ACCEPT}
          onChange={pickFile}
          tabIndex={-1}
          aria-hidden="true"
        />
        <button
          type="button"
          className={styles.attachBtn}
          aria-label="계약서 첨부"
          title={busy ? '계약서를 읽는 중입니다' : '계약서 첨부 (PDF·PNG·JPG)'}
          disabled={busy}
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
          disabled={disabled || !value.trim()}
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
