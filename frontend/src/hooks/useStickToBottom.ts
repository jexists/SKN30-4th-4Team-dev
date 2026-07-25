import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 스크롤 컨테이너가 "맨 아래 근처"인지 추적하고, 맨 아래로 보내는 헬퍼를 제공한다.
 *
 * 채팅에서 새 메시지·스트리밍이 올 때 사용자가 맨 아래를 보고 있으면 자동으로 따라 내려가고,
 * 위에서 옛 대화를 읽는 중이면 가만히 두기 위한 판정(atBottom)을 제공한다. 실제 자동 스크롤
 * 여부는 호출부(MessageList)가 atBottomRef 로 결정한다(렌더 사이 최신값이 필요하므로 ref 도 노출).
 */
interface Options {
  /** 이 픽셀 이내면 "맨 아래"로 본다. */
  threshold?: number
}

export function useStickToBottom(
  ref: React.RefObject<HTMLElement | null>,
  { threshold = 60 }: Options = {},
) {
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)

  const check = useCallback(() => {
    const el = ref.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const next = distance <= threshold
    atBottomRef.current = next
    setAtBottom((prev) => (prev === next ? prev : next))
  }, [ref, threshold])

  const scrollToBottom = useCallback(
    (smooth = true) => {
      const el = ref.current
      if (!el) return
      el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
      atBottomRef.current = true
      setAtBottom(true)
    },
    [ref],
  )

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.addEventListener('scroll', check, { passive: true })
    return () => el.removeEventListener('scroll', check)
  }, [ref, check])

  return { atBottom, atBottomRef, scrollToBottom, check }
}
