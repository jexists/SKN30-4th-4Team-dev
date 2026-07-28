import { useLayoutEffect, useRef } from 'react'

import { Close, FileLines, Info, Paperclip, Send } from '../../components/icons'
import styles from './Chat.module.scss'

/** OCR worker 가 처리 가능한 계약서 형식. */
const ACCEPT = '.pdf,.png,.jpg,.jpeg'

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
  /** 계약서 파일 첨부. 선택 즉시 분석을 시작한다(Chat 이 처리). */
  onAttach: (file: File) => void
  /** 분석 중(첨부 버튼 잠금 + 스피너 표기). */
  attaching?: boolean
  /** 첨부된 계약서 파일명(있을 때만 칩 표시). */
  attachedName?: string | null
  /** 첨부 해제. */
  onRemoveAttach?: () => void
}

const PLACEHOLDER = '법률적인 상황을 설명해주세요...'
const MAX_HEIGHT = 200 // px — 이 높이까지 늘고 그 뒤엔 내부 스크롤

/**
 * 하단 고정 입력창. Enter 전송 / Shift+Enter 줄바꿈, 내용이 길어지면 높이만 증가(상한 후 내부 스크롤),
 * 전송 중엔 비활성. 기존 .composer 마크업/스타일을 그대로 사용한다.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  disabled,
  notice,
  maxLength,
  onAttach,
  attaching = false,
  attachedName,
  onRemoveAttach,
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

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // 같은 파일을 다시 골라도 change 가 발생하도록 값을 비운다.
    e.target.value = ''
    if (file) onAttach(file)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className={styles.composer}>
      {(attachedName || attaching) && (
        <div className={styles.attachChip}>
          <FileLines className={styles.attachChipIcon} aria-hidden />
          <span className={styles.attachChipName}>
            {attaching ? '계약서 분석 중…' : attachedName}
          </span>
          {!attaching && onRemoveAttach && (
            <button
              type="button"
              className={styles.attachChipRemove}
              aria-label="첨부 계약서 제거"
              onClick={onRemoveAttach}
            >
              <Close />
            </button>
          )}
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
          accept={ACCEPT}
          className={styles.fileInput}
          onChange={onFilePick}
          tabIndex={-1}
          aria-hidden
        />
        <button
          type="button"
          className={styles.attachBtn}
          aria-label="계약서 첨부"
          title="계약서 첨부 (PDF·이미지)"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || attaching}
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
