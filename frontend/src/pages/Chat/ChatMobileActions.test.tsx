import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatMobileActions } from './ChatMobileActions'

function setup(hidden = false) {
  const onOpenHistory = vi.fn()
  const onNewChat = vi.fn()
  render(
    <ChatMobileActions onOpenHistory={onOpenHistory} onNewChat={onNewChat} hidden={hidden} />,
  )
  return { onOpenHistory, onNewChat }
}

describe('ChatMobileActions', () => {
  it('대화기록과 새 채팅 버튼을 함께 보여준다', () => {
    setup()

    expect(screen.getByRole('button', { name: '대화기록' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 채팅' })).toBeInTheDocument()
  })

  it('각 버튼이 자기 콜백을 부른다', async () => {
    const user = userEvent.setup()
    const { onOpenHistory, onNewChat } = setup()

    await user.click(screen.getByRole('button', { name: '대화기록' }))
    expect(onOpenHistory).toHaveBeenCalledOnce()
    expect(onNewChat).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '새 채팅' }))
    expect(onNewChat).toHaveBeenCalledOnce()
  })

  it('감춰지면 보조기술과 탭 순서에서 빠진다', () => {
    const { container } = render(
      <ChatMobileActions onOpenHistory={() => {}} onNewChat={() => {}} hidden />,
    )

    const actions = container.firstElementChild as HTMLElement
    expect(actions).toHaveAttribute('aria-hidden', 'true')
    expect(actions).toHaveAttribute('inert')
  })
})
