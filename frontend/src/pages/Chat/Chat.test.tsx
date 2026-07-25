import { render, screen, waitFor, within } from '@testing-library/react'
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
  updateRoomTitle: vi.fn(),
  deleteRoom: vi.fn(),
  sendChat: vi.fn(),
}))

vi.mock('../../api/chatHistory', () => ({
  listRooms: api.listRooms,
  listMessages: api.listMessages,
  createRoom: api.createRoom,
  addMessage: api.addMessage,
  updateRoomTitle: api.updateRoomTitle,
  deleteRoom: api.deleteRoom,
  ROOM_TITLE_MAX: 200,
}))
vi.mock('../../api/chat', () => ({ sendChat: api.sendChat }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: true }),
}))
vi.mock('../../config/supabase', () => ({
  isAuthConfigured: true,
  supabase: null,
}))

const today = new Date()
const yesterday = new Date(today)
yesterday.setDate(today.getDate() - 1)

const rooms = [
  {
    id: 'room-a',
    title: '첫 번째 대화',
    last_chat_at: today.toISOString(),
    updated_at: today.toISOString(),
  },
  {
    id: 'room-b',
    title: '두 번째 대화',
    last_chat_at: yesterday.toISOString(),
    updated_at: yesterday.toISOString(),
  },
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
    last_chat_at: today.toISOString(),
    updated_at: '2026-07-24T10:00:00Z',
  })
  api.addMessage.mockResolvedValue({
    id: 'stored-message',
    role: 'USER',
    content: '저장됨',
    created_at: '2026-07-24T10:00:00Z',
  })
  api.updateRoomTitle.mockResolvedValue({ ...rooms[0], title: '수정된 대화' })
  api.deleteRoom.mockResolvedValue(rooms[0])
  api.sendChat.mockResolvedValue({ answer: '테스트 답변', response_time_ms: 10 })
})

describe('Chat URL routing', () => {
  it('대화 목록을 마지막 채팅 날짜 그룹으로 표시한다', async () => {
    renderChat('/chat')

    expect(await screen.findByRole('heading', { name: '오늘' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '어제' })).toBeInTheDocument()
  })

  it('추천 주제를 접으면 칩이 사라지고 다시 펼칠 수 있다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    const toggle = await screen.findByRole('button', { name: /추천 주제/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true') // 기본은 펼침
    expect(screen.getByRole('button', { name: '보증금 반환' })).toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: '보증금 반환' })).not.toBeInTheDocument()

    await user.click(toggle)

    expect(screen.getByRole('button', { name: '보증금 반환' })).toBeInTheDocument()
  })

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

  // 실패의 "원인"은 공통 오류 모달이 알린다(api/client.test.ts 가 검증).
  // 이 화면이 책임지는 건 두 가지다 — Empty State 로 위장하지 않을 것, 재시도를 줄 것.

  it('존재하지 않는 chatId는 재시도를 권하지 않는다', async () => {
    api.listMessages.mockRejectedValueOnce(
      new ApiError('대화를 찾을 수 없습니다', '이미 삭제되었거나 존재하지 않는 대화입니다.', 404),
    )
    renderChat('/chat/missing-room')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('대화를 불러오지 못했습니다.')
    // 다시 눌러도 결과가 같으므로 재시도 버튼은 내지 않는다.
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/missing-room')
  })

  it('권한이 없는 대화도 재시도를 권하지 않는다', async () => {
    api.listMessages.mockRejectedValueOnce(
      new ApiError('권한 없음', '이 대화를 볼 수 있는 권한이 없습니다.', 403),
    )
    renderChat('/chat/room-a')

    expect(await screen.findByRole('alert')).toHaveTextContent('대화를 불러오지 못했습니다.')
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('대화 조회가 500이면 다시 시도 버튼으로 같은 대화를 재조회한다', async () => {
    const user = userEvent.setup()
    api.listMessages.mockRejectedValueOnce(
      new ApiError('서버 오류', '잠시 후 다시 시도해 주세요.', 500),
    )
    renderChat('/chat/room-a')

    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByText('room-a 질문')).toBeInTheDocument()
    expect(api.listMessages).toHaveBeenCalledTimes(2)
  })

  it('목록 조회가 500이면 빈 목록 대신 오류와 재시도를 보여준다', async () => {
    const user = userEvent.setup()
    api.listRooms.mockRejectedValueOnce(new ApiError('서버 오류', '잠시 후 다시 시도해 주세요.', 500))
    renderChat('/chat')

    // "아직 대화가 없어요" 로 위장하지 않는다 — 이게 이 화면의 원래 버그였다.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('대화 기록을 불러오지 못했습니다.')
    expect(screen.queryByText(/아직 대화가 없어요/)).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByRole('button', { name: '첫 번째 대화' })).toBeInTheDocument()
    expect(api.listRooms).toHaveBeenCalledTimes(2)
  })

  it('응답을 못 받으면(네트워크) 목록에 재시도를 준다', async () => {
    api.listRooms.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderChat('/chat')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('대화 기록을 불러오지 못했습니다.')
    expect(within(alert).getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })

  it('메뉴에서 제목을 수정하면 목록의 같은 자리에서 제목만 바꾸고 모달을 닫는다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    await screen.findByRole('button', { name: '첫 번째 대화' })
    await user.click(screen.getAllByRole('button', { name: '대화 옵션' })[0])
    await user.click(screen.getByRole('menuitem', { name: '제목 수정' }))

    const input = screen.getByRole('textbox', { name: '대화 제목' })
    expect(input).toHaveValue('첫 번째 대화')
    expect(input).toHaveFocus()
    await user.clear(input)
    await user.type(input, '수정된 대화')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => {
      expect(api.updateRoomTitle).toHaveBeenCalledWith('room-a', '수정된 대화')
    })
    expect(await screen.findByRole('button', { name: '수정된 대화' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '대화 제목 수정' })).not.toBeInTheDocument()

    const renamed = screen.getByRole('button', { name: '수정된 대화' })
    const second = screen.getByRole('button', { name: '두 번째 대화' })
    expect(renamed.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('제목이 공백뿐이면 저장할 수 없다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    await screen.findByRole('button', { name: '첫 번째 대화' })
    await user.click(screen.getAllByRole('button', { name: '대화 옵션' })[0])
    await user.click(screen.getByRole('menuitem', { name: '제목 수정' }))
    const input = screen.getByRole('textbox', { name: '대화 제목' })
    await user.clear(input)
    await user.type(input, '   ')

    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
  })

  it('삭제를 확인하면 API를 호출하고 목록에서 해당 대화를 제거한다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    await screen.findByRole('button', { name: '첫 번째 대화' })
    await user.click(screen.getAllByRole('button', { name: '대화 옵션' })[0])
    await user.click(screen.getByRole('menuitem', { name: '삭제' }))
    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(api.deleteRoom).toHaveBeenCalledWith('room-a')
    })
    expect(screen.queryByRole('button', { name: '첫 번째 대화' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '두 번째 대화' })).toBeInTheDocument()
  })

  it('보고 있던 대화를 삭제하면 새 대화 URL로 이동한다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')

    expect(await screen.findByText('room-a 질문')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '대화 옵션' })[0])
    await user.click(screen.getByRole('menuitem', { name: '삭제' }))
    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/chat')
    })
  })
})
