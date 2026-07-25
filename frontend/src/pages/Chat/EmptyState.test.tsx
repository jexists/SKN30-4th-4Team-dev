import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('안내 문구와 예시 질문 카드를 보여준다', () => {
    render(<EmptyState onExample={() => {}} />)
    expect(screen.getByRole('heading', { name: '무엇을 도와드릴까요?' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(4)
  })

  it('예시 카드를 누르면 그 질문으로 onExample 을 호출한다', async () => {
    const onExample = vi.fn()
    const user = userEvent.setup()
    render(<EmptyState onExample={onExample} />)

    const firstCard = screen.getAllByRole('button')[0]
    await user.click(firstCard)

    expect(onExample).toHaveBeenCalledTimes(1)
    expect(onExample.mock.calls[0][0]).toEqual(firstCard.textContent)
  })
})
