import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../api/client'
import { Chat } from './Chat'

const api = vi.hoisted(() => ({
  listRooms: vi.fn(),
  listMessages: vi.fn(),
  createRoom: vi.fn(),
  addMessage: vi.fn(),
  sendChat: vi.fn(),
}))

vi.mock('../../api/chatHistory', () => ({
  listRooms: api.listRooms,
  listMessages: api.listMessages,
  createRoom: api.createRoom,
  addMessage: api.addMessage,
}))
vi.mock('../../api/chat', () => ({ sendChat: api.sendChat }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: true }),
}))
vi.mock('../../config/supabase', () => ({
  isAuthConfigured: true,
  supabase: null,
}))

const rooms = [
  { id: 'room-a', title: '첫 번째 대화', updated_at: '2026-07-24T08:00:00Z' },
  { id: 'room-b', title: '두 번째 대화', updated_at: '2026-07-24T09:00:00Z' },
]

function LocationProbe() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  return (
    <>
      <output data-testid="location">{pathname}</output>
      <button type="button" onClick={() => navigate(-1)}>
        테스트 뒤로가기
      </button>
    </>
  )
}

function ChatRoute() {
  return (
    <>
      <LocationProbe />
      <Chat />
    </>
  )
}

function renderChat(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chat/:chatId?" element={<ChatRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn()
})

beforeEach(() => {
  vi.clearAllMocks()
  api.listRooms.mockResolvedValue({ items: rooms, next_cursor: null })
  api.listMessages.mockImplementation(async (roomId: string) => ({
    items: [
      {
        id: `message-${roomId}`,
        role: 'USER',
        content: `${roomId} 질문`,
        created_at: '2026-07-24T09:00:00Z',
      },
    ],
    next_cursor: null,
  }))
  api.createRoom.mockResolvedValue({
    id: 'room-new',
    title: '첫 질문',
    updated_at: '2026-07-24T10:00:00Z',
  })
  api.addMessage.mockResolvedValue({
    id: 'stored-message',
    role: 'USER',
    content: '저장됨',
    created_at: '2026-07-24T10:00:00Z',
  })
  api.sendChat.mockResolvedValue({ answer: '테스트 답변', response_time_ms: 10 })
})

describe('Chat URL routing', () => {
  it('직접 접근한 URL의 chatId로 메시지를 조회하고 목록 선택 상태를 표시한다', async () => {
    renderChat('/chat/room-a')

    expect(await screen.findByText('room-a 질문')).toBeInTheDocument()
    expect(api.listMessages).toHaveBeenCalledWith('room-a')
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-a')
    expect(screen.getByRole('button', { name: /첫 번째 대화/ })).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('목록 클릭과 브라우저 뒤로가기에 맞춰 URL과 메시지를 다시 불러온다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    await user.click(await screen.findByRole('button', { name: /두 번째 대화/ }))
    expect(await screen.findByText('room-b 질문')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-b')

    await user.click(screen.getByRole('button', { name: /첫 번째 대화/ }))
    expect(await screen.findByText('room-a 질문')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-a')

    await user.click(screen.getByRole('button', { name: '테스트 뒤로가기' }))
    expect(await screen.findByText('room-b 질문')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-b')
  })

  it('새 대화의 첫 메시지를 저장한 뒤 생성된 chatId를 URL에 반영한다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    const composer = await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...')
    await user.type(composer, '첫 질문')
    await user.click(screen.getByRole('button', { name: '전송' }))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-new')
    })
    // 새로 만든 방은 사이드바 맨 앞에 그대로 남고(목록을 다시 불러 덮어쓰지 않는다),
    // 본문에는 방금 보낸 사용자 말풍선이 보인다.
    const newRoom = await screen.findByRole('button', { name: /첫 질문/ })
    expect(newRoom).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('첫 질문', { selector: 'div' })).toBeInTheDocument()
    expect(api.listRooms).toHaveBeenCalledTimes(1) // 최초 1회뿐 — 답변 저장 후 재조회 없음
    expect(api.createRoom).toHaveBeenCalledWith('첫 질문')
    expect(api.addMessage).toHaveBeenCalledWith('room-new', 'USER', '첫 질문')
    expect(api.listMessages).not.toHaveBeenCalled()
  })

  it('존재하지 않거나 소유하지 않은 chatId는 접근 불가 상태를 표시하고 URL을 유지한다', async () => {
    api.listMessages.mockRejectedValueOnce(
      new ApiError('NOT_FOUND', '대화를 찾을 수 없습니다.', 404),
    )
    renderChat('/chat/missing-room')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('대화에 접근할 수 없습니다.')
    expect(alert).toHaveTextContent('존재하지 않거나 접근 권한이 없는 채팅입니다.')
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/missing-room')
  })
})
