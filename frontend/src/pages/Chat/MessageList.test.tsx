import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageList } from './MessageList'
import type { Message } from './types'

const scrollTo = vi.fn()
const noop = vi.fn()

const firstMessage: Message = { id: 'm1', role: 'assistant', content: '이전 답변' }

function renderList({
  messages = [firstMessage],
  sending = false,
  followLatestRequest = 0,
}: {
  messages?: Message[]
  sending?: boolean
  followLatestRequest?: number
} = {}) {
  return render(
    <MessageList
      messages={messages}
      sending={sending}
      isLoading={false}
      isLoadingOlder={false}
      hasMoreOlder={false}
      followLatestRequest={followLatestRequest}
      onLoadOlder={noop}
      onStreamingDone={noop}
      onRegenerate={noop}
    />,
  )
}

describe('메시지 안의 첨부', () => {
  it('사용자 말풍선에 보낸 파일이 질문과 함께 남는다', () => {
    renderList({
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: '계약서 분석해줘',
          attachments: [
            { name: '계약서.pdf', kind: 'pdf' },
            { name: '등기부.jpg', kind: 'image' },
          ],
        },
      ],
    })

    expect(screen.getByText('계약서 분석해줘')).toBeInTheDocument()
    expect(screen.getByText('계약서.pdf')).toBeInTheDocument()
    expect(screen.getByText('등기부.jpg')).toBeInTheDocument()
  })

  it('첨부를 읽는 동안에는 진행 말풍선을 보여준다', () => {
    renderList({
      messages: [{ id: 'm1', role: 'assistant', content: '계약서를 읽고 있습니다', pending: true }],
    })

    expect(screen.getByRole('status')).toHaveTextContent('계약서를 읽고 있습니다')
  })
})

function scrollUp() {
  const thread = screen.getByTestId('message-scroll')
  Object.defineProperties(thread, {
    scrollHeight: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 300 },
    scrollTop: { configurable: true, writable: true, value: 100 },
  })
  fireEvent.scroll(thread)
  return thread
}

beforeEach(() => {
  vi.clearAllMocks()
  HTMLElement.prototype.scrollTo = scrollTo
})

describe('MessageList 자동 스크롤', () => {
  it('과거를 보던 중 직접 전송하면 부드럽게 최신 메시지로 이동한다', () => {
    const view = renderList()
    scrollUp()
    expect(screen.getByRole('button', { name: '↓ 맨 아래로' })).toBeInTheDocument()

    view.rerender(
      <MessageList
        messages={[firstMessage, { id: 'm2', role: 'user', content: '새 질문' }]}
        sending
        isLoading={false}
        isLoadingOlder={false}
        hasMoreOlder={false}
        followLatestRequest={1}
        onLoadOlder={noop}
        onStreamingDone={noop}
        onRegenerate={noop}
      />,
    )

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
  })

  it('직접 전송으로 시작한 AI 응답이 추가되는 동안 하단 추적을 유지한다', () => {
    const view = renderList()
    scrollUp()

    view.rerender(
      <MessageList
        messages={[firstMessage, { id: 'm2', role: 'user', content: '새 질문' }]}
        sending
        isLoading={false}
        isLoadingOlder={false}
        hasMoreOlder={false}
        followLatestRequest={1}
        onLoadOlder={noop}
        onStreamingDone={noop}
        onRegenerate={noop}
      />,
    )
    scrollTo.mockClear()

    view.rerender(
      <MessageList
        messages={[
          firstMessage,
          { id: 'm2', role: 'user', content: '새 질문' },
          {
            id: 'm3',
            role: 'assistant',
            content: '길게 생성되는 답변입니다. 계속해서 새로운 내용이 표시됩니다.',
            streaming: true,
          },
        ]}
        sending={false}
        isLoading={false}
        isLoadingOlder={false}
        hasMoreOlder={false}
        followLatestRequest={1}
        onLoadOlder={noop}
        onStreamingDone={noop}
        onRegenerate={noop}
      />,
    )

    expect(scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: 'auto' })
  })

  it('직접 전송이 아닌 append는 과거 조회 위치를 유지한다', () => {
    const view = renderList()
    scrollUp()
    scrollTo.mockClear()

    view.rerender(
      <MessageList
        messages={[
          firstMessage,
          { id: 'm2', role: 'assistant', content: '외부에서 추가된 메시지' },
        ]}
        sending={false}
        isLoading={false}
        isLoadingOlder={false}
        hasMoreOlder={false}
        followLatestRequest={0}
        onLoadOlder={noop}
        onStreamingDone={noop}
        onRegenerate={noop}
      />,
    )

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '새 메시지 ↓' })).toBeInTheDocument()
  })

  it('채팅방 최초 로딩 시 마지막 메시지로 이동한다', () => {
    const view = renderList({ messages: [] })
    const thread = screen.getByTestId('message-scroll')
    Object.defineProperties(thread, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 300 },
    })

    view.rerender(
      <MessageList
        messages={[firstMessage]}
        sending={false}
        isLoading={false}
        isLoadingOlder={false}
        hasMoreOlder={false}
        followLatestRequest={0}
        onLoadOlder={noop}
        onStreamingDone={noop}
        onRegenerate={noop}
      />,
    )

    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' })
  })
})
