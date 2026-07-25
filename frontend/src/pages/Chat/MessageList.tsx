import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { BRAND } from '../../config/env'
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
  /** 사용자가 전송할 때마다 증가. 과거를 보고 있어도 최신 메시지 추적을 강제로 시작한다. */
  followLatestRequest: number
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
  followLatestRequest,
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
  const prevFirstId = useRef(messages[0]?.id)
  const prevSending = useRef(sending)
  const prevFollowLatestRequest = useRef(followLatestRequest)
  // 사용자가 보낸 직후부터 AI 타이핑이 끝날 때까지는 수동으로 위로 올려도 새 내용과 함께 하단 추적.
  const forceFollow = useRef(false)
  const hasStreaming = messages.some((message) => message.streaming)

  const followGrow = useCallback(() => {
    if (forceFollow.current || atBottomRef.current) scrollToBottom(false)
  }, [atBottomRef, scrollToBottom])

  // 메시지·대기 상태 변화:
  // - 직접 전송 요청은 현재 위치와 무관하게 smooth 하단 이동 + 응답 완료까지 강제 추적
  // - 과거 prepend 는 평소 위치 보존
  // - 그 외 append 는 기존처럼 맨 아래를 보던 사용자만 따라감
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    // 저장해 둔 보정값은 '실제로 앞에 붙었을 때'만 쓴다. 요청이 조기 반환되거나 실패하면
    // prepend 는 오지 않는데, 그 값을 남겨 두면 다음 append(=새 답변) 가 과거 로딩으로
    // 오인돼 스크롤이 엉뚱한 곳으로 튄다. 확인되지 않은 보정값은 그냥 버린다.
    const firstId = messages[0]?.id
    const grew = messages.length > prevLen.current
    const prepended = grew && firstId !== undefined && firstId !== prevFirstId.current
    const pending = pendingPrepend.current
    pendingPrepend.current = null
    const followRequested = followLatestRequest !== prevFollowLatestRequest.current
    const sendingChanged = sending !== prevSending.current

    if (followRequested) {
      forceFollow.current = true
      setHasNew(false)
      scrollToBottom(true)
    } else if (pending && prepended && !forceFollow.current) {
      el.scrollTop = el.scrollHeight - pending.height + pending.top
    } else if (forceFollow.current || atBottomRef.current) {
      if (grew || sendingChanged) scrollToBottom(false)
    } else if (grew) {
      setHasNew(true)
    }

    // 마지막 타이핑 렌더까지 하단에 맞춘 뒤 평상시(사용자 스크롤 존중) 모드로 돌아간다.
    if (forceFollow.current && !sending && !hasStreaming) {
      scrollToBottom(false)
      forceFollow.current = false
    }

    prevLen.current = messages.length
    prevFirstId.current = firstId
    prevSending.current = sending
    prevFollowLatestRequest.current = followLatestRequest
  }, [
    messages,
    sending,
    hasStreaming,
    followLatestRequest,
    atBottomRef,
    scrollToBottom,
  ])

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
      <div className={styles.thread} ref={scrollRef} data-testid="message-scroll">
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
            <div className={styles.botCol}>
              {/* 답변이 도착할 때 라벨이 새로 끼어들어 줄이 밀리지 않도록 대기 중에도 같이 둔다. */}
              <span className={styles.botLabel}>
                <Shield className={styles.botLabelIcon} />
                {BRAND.name} 봇
              </span>
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
