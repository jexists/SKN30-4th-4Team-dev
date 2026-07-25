import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useTypewriter } from './useTypewriter'

describe('useTypewriter', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('active=false 면 애니메이션 없이 즉시 전체를 보여준다', () => {
    const { result } = renderHook(() => useTypewriter('안녕하세요', false))
    expect(result.current.displayed).toBe('안녕하세요')
    expect(result.current.done).toBe(true)
  })

  it('active=true 면 점진적으로 드러나 결국 전체가 완성되고 onDone 을 부른다', () => {
    const onDone = vi.fn()
    const { result } = renderHook(() =>
      useTypewriter('가나다라마바사아자차', true, { onDone, ticks: 4 }),
    )

    // 시작 직후엔 아직 다 드러나지 않았다.
    expect(result.current.done).toBe(false)
    expect(result.current.displayed.length).toBeLessThan(10)

    // 충분히 시간을 흘리면 전체가 완성된다.
    act(() => {
      vi.advanceTimersByTime(20 * 12)
    })
    expect(result.current.displayed).toBe('가나다라마바사아자차')
    expect(result.current.done).toBe(true)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('빈 문자열이면 즉시 완료된다', () => {
    const onDone = vi.fn()
    renderHook(() => useTypewriter('', true, { onDone }))
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
