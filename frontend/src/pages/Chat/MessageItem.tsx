import { memo, useLayoutEffect } from 'react'

import { BRAND } from '../../config/env'
import { Refresh, Shield, Warn } from '../../components/icons'
import { useTypewriter } from '../../hooks/useTypewriter'
import { AttachmentList } from './AttachmentList'
import { MarkdownMessage } from './MarkdownMessage'
import type { Message } from './types'
import styles from './Chat.module.scss'

interface Props {
  message: Message
  /** 타이핑 완료 시 부모에게 알림(스트리밍 플래그 해제 → 마크다운 렌더로 전환). */
  onStreamingDone: (id: string) => void
  /** 타이핑으로 내용이 자랄 때 호출(맨 아래면 컨테이너가 따라 내려가도록). */
  onContentGrow: () => void
  /**
   * 에러 버블의 '다시 생성' / 경고 줄의 '파일 다시 첨부' 콜백(있을 때만 버튼 표시).
   *
   * **어느 말풍선에서 눌렀는지**를 넘긴다. 예전엔 인자 없이 부르고 상위가 '마지막 질문' 을 다시
   * 보냈는데, 그 사이 다른 질문을 보냈으면 클릭한 턴이 아니라 최신 질문이 재전송됐다.
   */
  onRegenerate?: (messageId: string) => void
}

/**
 * 메시지 1개. 사용자/AI 를 구분해 렌더한다.
 * - AI 스트리밍 중: 타이핑으로 드러난 부분만 평문으로(마크다운은 완성 후) + 커서.
 * - AI 완료: 마크다운 렌더.
 * - 에러: 안내 + '다시 생성' 버튼.
 * - 첨부를 못 읽고 답한 경우: 말풍선 **위**에 경고 줄 + '파일 다시 첨부' 버튼. 답변 자체는
 *   정상이므로 말풍선을 빨갛게 물들이지 않는다 — 못 읽은 것은 파일이지 답변이 아니다.
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

  // 발신자는 좌우 정렬과 말풍선 색으로 구분한다 — 아바타·이름표를 매 줄 반복하지 않는다.
  if (message.role === 'user') {
    return (
      <div className={`${styles.msgRow} ${styles.msgUser}`}>
        <div className={styles.bubbleUser}>
          {/* 첨부는 질문 위에 둔다 — "이걸 두고 이렇게 물었다" 는 순서로 읽힌다. */}
          <AttachmentList
            items={(message.attachments ?? []).map((a, i) => ({
              key: `${message.id}-${i}`,
              name: a.name,
              kind: a.kind,
              previewUrl: a.previewUrl,
            }))}
            variant="message"
          />
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.msgRow}>
      <div className={styles.botCol}>
        {/* 답변의 출처 라벨. 사용자 메시지는 우측 정렬만으로 구분되므로 붙이지 않는다. */}
        <span className={styles.botLabel}>
          <Shield className={styles.botLabelIcon} />
          {BRAND.name} 봇
        </span>
        {/* 답변보다 먼저 읽혀야 한다 — 답 아래에 두면 이미 계약서를 본 답으로 읽고 지나친다. */}
        {message.degradedNotice && (
          <div className={styles.degradedNotice} role="status">
            <Warn className={styles.degradedIcon} />
            <span className={styles.degradedText}>{message.degradedNotice}</span>
            {onRegenerate && (
              <button
                type="button"
                className={styles.degradedRetry}
                onClick={() => onRegenerate(message.id)}
              >
                <Refresh className={styles.regenIcon} /> 파일 다시 첨부
              </button>
            )}
          </div>
        )}
        <div className={`${styles.bubbleBot} ${message.error ? styles.bubbleError : ''}`}>
          {message.pending ? (
            // 첨부를 읽는 동안의 자리표시. 답변이 오면 이 말풍선이 통째로 교체된다.
            <span className={styles.pendingText} role="status">
              {message.content}
              <span className={styles.pendingDots} aria-hidden="true" />
            </span>
          ) : message.error ? (
            <div className={styles.errorBubble}>
              <span>{message.content}</span>
              {onRegenerate && (
                <button
                  type="button"
                  className={styles.regen}
                  onClick={() => onRegenerate(message.id)}
                >
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
      </div>
    </div>
  )
})
