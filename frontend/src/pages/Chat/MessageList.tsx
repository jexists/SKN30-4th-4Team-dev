import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Shield } from '../../components/icons'
import { useStickToBottom } from '../../hooks/useStickToBottom'
import { MessageItem } from './MessageItem'
import type { Message } from './types'
import styles from './Chat.module.scss'

interface Props {
  messages: Message[]
  /** AI 응답 대기(생성 중) → 하단 타이핑 인디케이터. */
  sending: boolean
  /** 방 열기 로딩 → 스켈레톤. */
  isLoading: boolean
  /** 과거 메시지 로딩 중 → 상단 로더. */
  isLoadingOlder: boolean
  /** 더 과거가 있는지(=cursor≠null). */
  hasMoreOlder: boolean
  onLoadOlder: () => void
  onStreamingDone: (id: string) => void
  onRegenerate: () => void
}

function Skeletons() {
  return (
    <div className={styles.skeletonWrap} aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className={i % 2 ? styles.skelUser : styles.skelBot} />
      ))}
    </div>
  )
}

/**
 * 유일한 스크롤 컨테이너. 자동 스크롤(맨 아래 추적)·과거 무한스크롤(위로)·스켈레톤/로더/
 * '↓ 맨 아래로·새 메시지' 버튼을 담당한다. 방이 바뀔 때는 상위에서 key 로 리마운트해 스크롤
 * 상태를 깨끗이 초기화한다(맨 아래에서 시작).
 */
export function MessageList({
  messages,
  sending,
  isLoading,
  isLoadingOlder,
  hasMoreOlder,
  onLoadOlder,
  onStreamingDone,
  onRegenerate,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const topSentinelRef = useRef<HTMLDivElement>(null)
  const { atBottom, atBottomRef, scrollToBottom } = useStickToBottom(scrollRef)
  const [hasNew, setHasNew] = useState(false)

  // 과거 prepend 위치 보정용(로딩 직전 스크롤 상태 저장).
  const pendingPrepend = useRef<{ height: number; top: number } | null>(null)
  const prevLen = useRef(messages.length)

  const followGrow = useCallback(() => {
    if (atBottomRef.current) scrollToBottom(false)
  }, [atBottomRef, scrollToBottom])

  // 메시지 변화: prepend 면 위치 유지, append 면 (맨 아래일 때만) 따라가고 아니면 '새 메시지' 노출.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const pending = pendingPrepend.current
    if (pending) {
      pendingPrepend.current = null
      el.scrollTop = el.scrollHeight - pending.height + pending.top
    } else {
      const grew = messages.length > prevLen.current
      if (atBottomRef.current) scrollToBottom(false)
      else if (grew) setHasNew(true)
    }
    prevLen.current = messages.length
  }, [messages, atBottomRef, scrollToBottom])

  // 응답 대기 인디케이터가 뜰 때도 맨 아래면 따라감.
  useLayoutEffect(() => {
    if (sending && atBottomRef.current) scrollToBottom(false)
  }, [sending, atBottomRef, scrollToBottom])

  // 맨 아래로 내려오면 '새 메시지' 해제.
  useEffect(() => {
    if (atBottom) setHasNew(false)
  }, [atBottom])

  // 상단 sentinel 이 보이면 과거 로딩(로딩 직전 스크롤 높이 저장 → 위치 보정).
  useEffect(() => {
    const sentinel = topSentinelRef.current
    const root = scrollRef.current
    if (!sentinel || !root || !hasMoreOlder) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingOlder) {
          const el = scrollRef.current
          if (el) pendingPrepend.current = { height: el.scrollHeight, top: el.scrollTop }
          onLoadOlder()
        }
      },
      { root, rootMargin: '90px 0px 0px 0px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [hasMoreOlder, isLoadingOlder, onLoadOlder])

  function jump() {
    scrollToBottom(true)
    setHasNew(false)
  }

  return (
    <div className={styles.listWrap}>
      <div className={styles.thread} ref={scrollRef}>
        <div ref={topSentinelRef} className={styles.topSentinel} />
        {isLoadingOlder && (
          <div className={styles.topLoader} aria-label="이전 메시지 불러오는 중">
            <span />
            <span />
            <span />
          </div>
        )}

        {isLoading ? (
          <Skeletons />
        ) : (
          messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              onStreamingDone={onStreamingDone}
              onContentGrow={followGrow}
              onRegenerate={m.error ? onRegenerate : undefined}
            />
          ))
        )}

        {sending && (
          <div className={styles.msgRow}>
            <div className={styles.botAvatar}>
              <Shield />
            </div>
            <div className={styles.msgCol}>
              <div className={`${styles.bubbleBot} ${styles.typing}`} aria-label="답변 생성 중">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}
      </div>

      {!atBottom && (
        <button type="button" className={styles.jumpBtn} onClick={jump}>
          {hasNew ? '새 메시지 ↓' : '↓ 맨 아래로'}
        </button>
      )}
    </div>
  )
}
