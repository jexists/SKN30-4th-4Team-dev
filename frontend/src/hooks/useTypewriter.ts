import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 문자열을 타이핑하듯 점진적으로 노출하는 훅.
 *
 * active=true 이면 target 을 조금씩 드러내고, false 이면 즉시 전체를 보여준다(이미 저장된
 * 과거 메시지는 애니메이션 없이 바로 표시).
 *
 * 리듬 규칙 — '사람이 치는 것 같게'가 목표다.
 * - 걸음 간격을 매번 흔들어(JITTER) 일정한 기계음 같은 느낌을 없앤다.
 * - 문장이 끝나는 자리(. ! ? …)에서 아주 짧게 쉰다.
 * - 아주 짧은 답변("네." 같은)은 연출 없이 그냥 띄운다 — 한 글자씩 찍으면 더 어색하다.
 * - 첫 글자 전에 준비 시간을 조금 둬서 '생성 중'인 느낌을 준다.
 * - 길이가 얼마든 MAX_DURATION_MS 안에는 끝나되, 걸음당 글자 수를 실수로 누적해
 *   길이 경계에서 속도가 툭 튀지 않게 한다(긴 답변도 끊김 없이 이어진다).
 */
interface Options {
  /** 노출 완료 시 1회 호출. */
  onDone?: () => void
  /** 이 길이(글자 수) 이하는 연출 없이 즉시 전체를 보여준다. 기본 15. */
  instantMax?: number
}

const TICK_MS = 24 // 한 걸음의 기본 간격(≈40자/초 — 사람이 읽어 내려가는 속도)
const JITTER = 0.35 // 걸음마다 ±35% 흔든다
const MAX_DURATION_MS = 6000 // 아무리 긴 답변도 타이핑 자체는 이 안에 끝난다
const START_DELAY_MS = 250 // 첫 글자 전 '준비' 시간
const SENTENCE_PAUSE_MS = 110 // 문장 끝에서 쉬는 시간
const INSTANT_MAX = 15 // "네." "가능합니다." 처럼 짧은 답변의 기준
const SENTENCE_END = /[.!?…。！？]/

/**
 * 사람이 한 글자로 인지하는 단위(grapheme)로 쪼갠다.
 *
 * String.length·slice 는 UTF-16 코드유닛 기준이라 이모지(서로게이트 쌍·ZWJ 로 이어붙인
 * 가족 이모지)나 결합 문자를 중간에서 잘라 �나 낱자가 잠깐 보인다. Intl.Segmenter 가 없는
 * 환경에서는 코드포인트 단위(Array.from)로 폴백한다 — 서로게이트 쌍만이라도 지켜진다.
 */
function toGraphemes(text: string): string[] {
  if (typeof Intl.Segmenter !== 'function') return Array.from(text)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

export function useTypewriter(
  target: string,
  active: boolean,
  { onDone, instantMax = INSTANT_MAX }: Options = {},
) {
  const graphemes = useMemo(() => toGraphemes(target), [target])
  const total = graphemes.length
  const [count, setCount] = useState(active && total > instantMax ? 0 : total)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    // 과거 메시지: 애니메이션도, 완료 통보도 없다(이미 완료된 메시지다).
    if (!active) {
      setCount(total)
      return
    }
    // 짧은 답변·빈 문자열: 바로 다 보여주고 끝났다고 알린다.
    if (total <= instantMax) {
      setCount(total)
      onDoneRef.current?.()
      return
    }

    setCount(0)
    // 걸음당 글자 수. 1 미만으로는 안 내려가고, 길면 비례해서 커진다.
    const perStep = Math.max(1, total / (MAX_DURATION_MS / TICK_MS))

    /**
     * i 번째 글자까지 드러낸 시점이 문장 끝인가. 소수점·조문 번호(3.5, 제7.2조)는 제외한다.
     *
     * 걸음 경계에서만 본다. 그래서 아주 긴 답변(걸음당 여러 글자)에서는 문장 끝에 딱 멈추는
     * 일이 드물어 쉼이 거의 걸리지 않는데, 빠르게 흐르는 중의 쉼은 덜컥거림으로 보이므로
     * 오히려 이 편이 자연스럽다.
     */
    const endsSentence = (i: number): boolean => {
      const last = graphemes[i - 1]
      if (last === undefined || !SENTENCE_END.test(last)) return false
      const next = graphemes[i]
      return next === undefined || /\s/.test(next)
    }

    let progress = 0
    let timer: ReturnType<typeof setTimeout>

    const step = () => {
      progress = Math.min(total, progress + perStep)
      const revealed = Math.floor(progress)
      setCount(revealed)
      if (revealed >= total) {
        onDoneRef.current?.()
        return
      }
      const jittered = TICK_MS * (1 + (Math.random() * 2 - 1) * JITTER)
      timer = setTimeout(step, jittered + (endsSentence(revealed) ? SENTENCE_PAUSE_MS : 0))
    }

    timer = setTimeout(step, START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [graphemes, total, active, instantMax])

  const done = count >= total
  // 완료 후에는 원본을 그대로 돌려준다(합쳐 만든 문자열과 같지만 불필요한 join 을 피한다).
  return { displayed: done ? target : graphemes.slice(0, count).join(''), done }
}
