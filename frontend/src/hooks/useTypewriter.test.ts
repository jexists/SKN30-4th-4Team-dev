import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTypewriter } from './useTypewriter'

/** done 이 될 때까지 흘린 시간(ms). 걸음마다 타이머가 다시 잡히므로 조금씩 전진시킨다. */
function advanceUntilDone(done: () => boolean, cap = 30000): number {
  let elapsed = 0
  while (!done() && elapsed < cap) {
    act(() => {
      vi.advanceTimersByTime(10)
    })
    elapsed += 10
  }
  return elapsed
}

describe('useTypewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('active=false 면 애니메이션 없이 즉시 전체를 보여준다', () => {
    const { result } = renderHook(() => useTypewriter('안녕하세요', false))
    expect(result.current.displayed).toBe('안녕하세요')
    expect(result.current.done).toBe(true)
  })

  it('active=true 면 점진적으로 드러나 결국 전체가 완성되고 onDone 을 부른다', () => {
    const onDone = vi.fn()
    const target = '가나다라마바사아자차'.repeat(4) // 40자 — 즉시 표시 기준을 넘긴다
    const { result } = renderHook(() => useTypewriter(target, true, { onDone }))

    // 시작 직후엔 아직 아무것도 드러나지 않았다(준비 시간).
    expect(result.current.done).toBe(false)
    expect(result.current.displayed).toBe('')

    advanceUntilDone(() => result.current.done)
    expect(result.current.displayed).toBe(target)
    expect(result.current.done).toBe(true)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('빈 문자열이면 즉시 완료된다', () => {
    const onDone = vi.fn()
    renderHook(() => useTypewriter('', true, { onDone }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  // "네." 처럼 짧은 답변은 한 글자씩 찍으면 오히려 어색하다.
  it('아주 짧은 답변은 타이머 없이 바로 전체를 보여준다', () => {
    const onDone = vi.fn()
    const { result } = renderHook(() => useTypewriter('가능합니다.', true, { onDone }))

    // 시간을 전혀 흘리지 않았는데도 완성 상태다.
    expect(result.current.displayed).toBe('가능합니다.')
    expect(result.current.done).toBe(true)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  // 응답이 도착하자마자 글자가 튀어나오면 '생성 중'인 느낌이 없다.
  it('첫 글자 전에 200~300ms 정도의 준비 시간을 둔다', () => {
    const target = '가나다라마바사아자차'.repeat(4)
    const { result } = renderHook(() => useTypewriter(target, true))

    act(() => {
      vi.advanceTimersByTime(180)
    })
    expect(result.current.displayed).toBe('') // 아직 준비 중

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.displayed.length).toBeGreaterThan(0) // 시작됐다
  })

  // 문장이 끝나는 자리에서 잠깐 쉬어야 읽는 리듬이 생긴다.
  it('문장 끝(. ! ?)에서는 잠깐 쉬어 같은 길이라도 더 오래 걸린다', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // 흔들림 제거 → 두 경우를 비교 가능하게

    const plain = '가나다라마바사아자차'.repeat(4) // 40자, 문장 끝 없음
    const sentences = '가나다라마바사아. '.repeat(4) // 40자, 문장 끝 4번

    const { result: a } = renderHook(() => useTypewriter(plain, true))
    const plainMs = advanceUntilDone(() => a.current.done)

    const { result: b } = renderHook(() => useTypewriter(sentences, true))
    const sentenceMs = advanceUntilDone(() => b.current.done)

    // 문장 끝 4번 × 110ms ≈ 440ms 만큼 더 걸린다.
    expect(sentenceMs - plainMs).toBeGreaterThanOrEqual(300)
  })

  // 긴 답변이 한 번에 쏟아지지도, 하염없이 늘어지지도 않아야 한다.
  it('긴 답변은 여러 걸음에 나눠 이어지며 제한 시간 안에 끝난다', () => {
    const target = '가'.repeat(3000)
    const { result } = renderHook(() => useTypewriter(target, true))

    act(() => {
      vi.advanceTimersByTime(400)
    })
    const early = result.current.displayed.length
    expect(early).toBeGreaterThan(0) // 시작은 했고
    expect(early).toBeLessThan(target.length) // 한 번에 다 나오진 않았다

    const totalMs = advanceUntilDone(() => result.current.done)
    expect(result.current.displayed).toBe(target)
    expect(totalMs).toBeLessThan(9000)
  })

  // UTF-16 코드유닛으로 자르면 이모지·결합 문자가 중간에서 깨져 �가 잠깐 보인다.
  it('이모지와 결합 문자를 중간에서 쪼개지 않는다', () => {
    // ZWJ 가족 이모지 · 결합 악센트(e + U+0301) · 국기(지역표시자 쌍)
    const target = '가👩‍👩‍👧‍👦나é다🇰🇷'
    const { result } = renderHook(() => useTypewriter(target, true, { instantMax: 0 }))

    // 한 걸음씩 흘리며 매 순간 노출 문자열이 target 의 온전한 접두사인지 본다.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (let i = 0; i < 40; i += 1) {
      act(() => {
        vi.advanceTimersByTime(30)
      })
      const shown = result.current.displayed
      expect(target.startsWith(shown)).toBe(true)
      expect(loneSurrogate.test(shown)).toBe(false) // 서로게이트 쌍이 반쪽만 남지 않았는지
      expect(shown.endsWith('e')).toBe(false) // 결합 악센트가 떨어져 나간 맨 e 가 아닌지
    }
    expect(result.current.displayed).toBe(target)
    expect(result.current.done).toBe(true)
  })
})
