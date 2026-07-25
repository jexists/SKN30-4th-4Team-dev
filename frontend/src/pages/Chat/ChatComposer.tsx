import { useLayoutEffect, useRef } from 'react'

import { Info, Paperclip, Send } from '../../components/icons'
import styles from './Chat.module.scss'

interface Props {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  /** 전송 중(중복 전송 방지). */
  disabled: boolean
  maxLength: number
}

const MAX_HEIGHT = 200 // px — 이 높이까지 늘고 그 뒤엔 내부 스크롤

/**
 * 하단 고정 입력창. Enter 전송 / Shift+Enter 줄바꿈, 내용이 길어지면 높이만 증가(상한 후 내부 스크롤),
 * 전송 중엔 비활성. 기존 .composer 마크업/스타일을 그대로 사용한다.
 */
export function ChatComposer({ value, onChange, onSubmit, disabled, maxLength }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

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

  return (
    <div className={styles.composer}>
      <form
        className={styles.inputBar}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <button type="button" className={styles.attachBtn} aria-label="파일 첨부">
          <Paperclip />
        </button>
        <textarea
          ref={ref}
          className={styles.input}
          placeholder="법률적인 상황을 설명해주세요..."
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
