import { useEffect, useRef, useState } from 'react'

/**
 * 문자열을 타이핑하듯 점진적으로 노출하는 훅.
 *
 * active=true 이면 target 을 처음부터 조금씩 드러내고, false 이면 즉시 전체를 보여준다
 * (이미 저장된 과거 메시지는 애니메이션 없이 바로 표시). 전체 노출 시간이 길이와 무관하게
 * 대략 일정하도록 프레임당 글자 수를 길이에 비례시켜, 아주 긴 답변도 답답하지 않게 한다.
 */
interface Options {
  /** 노출 완료 시 1회 호출. */
  onDone?: () => void
  /** 전체를 드러내기까지의 대략적인 틱 수(틱=20ms). 기본 60 → 약 1.2초. */
  ticks?: number
}

export function useTypewriter(target: string, active: boolean, { onDone, ticks = 60 }: Options = {}) {
  const [count, setCount] = useState(active ? 0 : target.length)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!active) {
      setCount(target.length)
      return
    }
    setCount(0)
    if (target.length === 0) {
      onDoneRef.current?.()
      return
    }
    const perTick = Math.max(1, Math.ceil(target.length / ticks))
    let current = 0
    const id = setInterval(() => {
      current = Math.min(target.length, current + perTick)
      setCount(current)
      if (current >= target.length) {
        clearInterval(id)
        onDoneRef.current?.()
      }
    }, 20)
    return () => clearInterval(id)
  }, [target, active, ticks])

  return { displayed: target.slice(0, count), done: count >= target.length }
}
