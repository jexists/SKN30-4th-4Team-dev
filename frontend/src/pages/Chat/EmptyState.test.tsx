import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { EmptyState } from './EmptyState'
import { DEFAULT_TOPIC, TOPICS } from './topics'

describe('EmptyState', () => {
  it('안내 문구와 추천 질문 카드를 보여준다', () => {
    render(<EmptyState topic={DEFAULT_TOPIC} onExample={() => {}} />)
    expect(screen.getByRole('heading', { name: '무엇을 도와드릴까요?' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(DEFAULT_TOPIC.questions.length)
  })

  it('추천 주제를 받으면 제목·설명·추천 질문을 그 주제 것으로 보여준다', () => {
    const deposit = TOPICS[0]
    render(<EmptyState topic={deposit} onExample={() => {}} />)

    expect(screen.getByRole('heading', { name: deposit.title })).toBeInTheDocument()
    expect(screen.getByText(deposit.description)).toBeInTheDocument()
    for (const q of deposit.questions) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument()
    }
    // 기본 화면의 질문은 남아 있지 않는다 — 통째로 교체된다.
    expect(
      screen.queryByRole('button', { name: DEFAULT_TOPIC.questions[0] }),
    ).not.toBeInTheDocument()
  })

  it('추천 질문 카드를 누르면 그 질문으로 onExample 을 호출한다', async () => {
    const onExample = vi.fn()
    const user = userEvent.setup()
    render(<EmptyState topic={DEFAULT_TOPIC} onExample={onExample} />)

    const firstCard = screen.getAllByRole('button')[0]
    await user.click(firstCard)

    expect(onExample).toHaveBeenCalledTimes(1)
    expect(onExample.mock.calls[0][0]).toEqual(firstCard.textContent)
  })
})
