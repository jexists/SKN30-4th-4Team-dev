import { memo, useLayoutEffect } from 'react'

import { BRAND } from '../../config/env'
import { Refresh, Shield, User } from '../../components/icons'
import { useTypewriter } from '../../hooks/useTypewriter'
import { MarkdownMessage } from './MarkdownMessage'
import type { Message } from './types'
import styles from './Chat.module.scss'

interface Props {
  message: Message
  /** 타이핑 완료 시 부모에게 알림(스트리밍 플래그 해제 → 마크다운 렌더로 전환). */
  onStreamingDone: (id: string) => void
  /** 타이핑으로 내용이 자랄 때 호출(맨 아래면 컨테이너가 따라 내려가도록). */
  onContentGrow: () => void
  /** 에러 버블의 '다시 생성' 콜백(있을 때만 버튼 표시). */
  onRegenerate?: () => void
}

/**
 * 메시지 1개. 사용자/AI 를 구분해 렌더한다.
 * - AI 스트리밍 중: 타이핑으로 드러난 부분만 평문으로(마크다운은 완성 후) + 커서.
 * - AI 완료: 마크다운 렌더.
 * - 에러: 안내 + '다시 생성' 버튼.
 */
export const MessageItem = memo(function MessageItem({
  message,
  onStreamingDone,
  onContentGrow,
  onRegenerate,
}: Props) {
  const streaming = Boolean(message.streaming) && message.role === 'assistant' && !message.error
  const { displayed, done } = useTypewriter(message.content, streaming, {
    onDone: () => onStreamingDone(message.id),
  })

  useLayoutEffect(() => {
    if (streaming) onContentGrow()
  }, [displayed, streaming, onContentGrow])

  if (message.role === 'user') {
    return (
      <div className={`${styles.msgRow} ${styles.msgUser}`}>
        <div className={styles.msgCol}>
          <div className={styles.bubbleUser}>{message.content}</div>
          <span className={styles.meta}>사용자</span>
        </div>
        <div className={styles.userAvatar}>
          <User />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.msgRow}>
      <div className={styles.botAvatar}>
        <Shield />
      </div>
      <div className={styles.msgCol}>
        <div className={`${styles.bubbleBot} ${message.error ? styles.bubbleError : ''}`}>
          {message.error ? (
            <div className={styles.errorBubble}>
              <span>{message.content}</span>
              {onRegenerate && (
                <button type="button" className={styles.regen} onClick={onRegenerate}>
                  <Refresh className={styles.regenIcon} /> 다시 생성
                </button>
              )}
            </div>
          ) : streaming ? (
            <span className={styles.streamText}>
              {displayed}
              {/* 커서는 '생성 중'에만. 마지막 글자가 찍히는 순간 사라진다 —
                  부모가 streaming 을 내리는 것(onStreamingDone)까지 기다리지 않는다. */}
              {!done && <span className={styles.caret} aria-hidden="true" />}
            </span>
          ) : (
            <MarkdownMessage content={message.content} />
          )}
        </div>
        <span className={styles.meta}>{BRAND.name} 봇</span>
      </div>
    </div>
  )
})
