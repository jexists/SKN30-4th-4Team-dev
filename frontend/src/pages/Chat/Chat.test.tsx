import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../../api/client'
import { BRAND } from '../../config/env'
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

/** 응답 도착 시점을 테스트가 직접 정한다 — "기다리는 중" 상태를 붙잡아 두기 위해. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

/** 본문 하단 타이핑 인디케이터. 사이드바 점과 라벨이 같으므로 대화 영역으로 좁혀서 찾는다. */
const typingIndicator = () =>
  screen.queryByTestId('message-scroll')
    ? within(screen.getByTestId('message-scroll')).queryByLabelText('답변 생성 중')
    : null

/** 사이드바에서 생성 중 점이 붙은 대화 제목들. */
const generatingRooms = () =>
  screen
    .queryAllByRole('img', { name: '답변 생성 중' })
    .map((dot) => dot.closest('button')?.textContent)

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

/** 모바일 레이아웃으로 전환한다 — useIsMobile 이 보는 matchMedia 를 갈아끼운다. */
function mobileViewport() {
  window.matchMedia = (query: string) =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

let desktopMatchMedia: typeof window.matchMedia

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn()
  desktopMatchMedia = window.matchMedia // setup.ts 의 기본 스텁(= 데스크탑)
})

afterEach(() => {
  window.matchMedia = desktopMatchMedia
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

  it('대화가 0건이면 목록에 "대화가 없습니다" 만 보여준다', async () => {
    api.listRooms.mockResolvedValueOnce({ items: [], next_cursor: null })
    renderChat('/chat')

    expect(await screen.findByText('대화가 없습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/질문을 입력해 시작/)).not.toBeInTheDocument()
  })

  it('추천 주제를 고르면 채팅을 만들지 않고 가운데 Hero 만 바꾼다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    const chip = await screen.findByRole('button', { name: '수리비 분쟁' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: '수리비 분쟁' })).toBeInTheDocument()
    expect(screen.getByText('수리비 및 원상복구와 관련된 질문입니다.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '누수 수리비는 누가 부담하나요?' }),
    ).toBeInTheDocument()
    // 기본 화면은 통째로 교체되고, 이 시점엔 아직 채팅이 생기지 않는다.
    expect(screen.queryByRole('heading', { name: '무엇을 도와드릴까요?' })).not.toBeInTheDocument()
    expect(api.createRoom).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/chat$/)
  })

  it('고른 주제를 다시 누르면 기본 화면으로 돌아간다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    const chip = await screen.findByRole('button', { name: '보증금 반환' })
    await user.click(chip)
    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('heading', { name: '무엇을 도와드릴까요?' })).toBeInTheDocument()
  })

  it('추천 질문을 누르면 그때 새 채팅을 만들고 질문을 자동 전송한다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    await user.click(await screen.findByRole('button', { name: '보증금 반환' }))
    const question = '임차권등기명령은 언제 신청하나요?'
    await user.click(screen.getByRole('button', { name: question }))

    await waitFor(() => {
      expect(api.createRoom).toHaveBeenCalledWith(question)
    })
    expect(api.addMessage).toHaveBeenCalledWith('room-new', 'USER', question)
    // 세 번째 인자는 첨부 계약서 맥락(document_context) — 첨부가 없으면 undefined.
    expect(api.sendChat).toHaveBeenCalledWith(question, [], undefined)
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-new')
    })
    expect(await screen.findByText('테스트 답변')).toBeInTheDocument()
  })

  it('대화를 보는 중에 추천 주제를 고르면 새 대화 화면으로 나가 그 주제를 보여준다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')

    expect(await screen.findByText('room-a 질문')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '해지 통보 시점' }))

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/chat$/)
    })
    expect(await screen.findByRole('heading', { name: '해지 통보 시점' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '해지 통보 시점' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('직접 접근한 URL의 chatId로 메시지를 조회하고 목록 선택 상태를 표시한다', async () => {
    renderChat('/chat/room-a')

    expect(await screen.findByText('room-a 질문')).toBeInTheDocument()
    expect(api.listMessages).toHaveBeenCalledWith('room-a', null, { silent: true })
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

  // 대화 조회 실패는 대화 영역 전체가 실패로 덮이므로 공통 오류 모달을 끄고(silent) 이 자리에서만
  // 알린다. 그래서 이 화면이 책임지는 건 셋이다 — Empty State 로 위장하지 않을 것, 서버가 준
  // 문구를 그대로 보일 것, 그리고 재시도가 없는 실패에서 빠져나갈 길을 줄 것.

  it('존재하지 않는 chatId는 서버 문구를 그대로 보이고 재시도를 권하지 않는다', async () => {
    const user = userEvent.setup()
    api.listMessages.mockRejectedValueOnce(
      new ApiError('대화를 찾을 수 없습니다', '이미 삭제되었거나 존재하지 않는 대화입니다.', 404),
    )
    renderChat('/chat/missing-room')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('이미 삭제되었거나 존재하지 않는 대화입니다.')
    // 같은 말을 모달로 한 번 더 하지 않는다.
    expect(api.listMessages).toHaveBeenCalledWith('missing-room', null, { silent: true })
    // 다시 눌러도 결과가 같으므로 재시도 버튼은 내지 않는다.
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/missing-room')

    // 입력창도 없는 화면이라 이 버튼이 유일한 출구다.
    await user.click(within(alert).getByRole('button', { name: '새 대화 시작' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/chat')
  })

  it('내 대화가 아니어도 같은 안내를 보인다(존재 여부를 알려주지 않는다)', async () => {
    // 백엔드는 남의 방·없는 방·잘못된 UUID 를 모두 같은 404 문구로 묶는다.
    api.listMessages.mockRejectedValueOnce(
      new ApiError('대화를 찾을 수 없습니다', '이미 삭제되었거나 존재하지 않는 대화입니다.', 404),
    )
    renderChat('/chat/someone-elses-room')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이미 삭제되었거나 존재하지 않는 대화입니다.',
    )
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 대화 시작' })).toBeInTheDocument()
  })

  it('대화 조회가 500이면 다시 시도 버튼으로 같은 대화를 재조회한다', async () => {
    const user = userEvent.setup()
    api.listMessages.mockRejectedValueOnce(
      new ApiError('서버 오류', '잠시 후 다시 시도해 주세요.', 500),
    )
    renderChat('/chat/room-a')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('잠시 후 다시 시도해 주세요.')
    await user.click(within(alert).getByRole('button', { name: '다시 시도' }))

    expect(await screen.findByText('room-a 질문')).toBeInTheDocument()
    expect(api.listMessages).toHaveBeenCalledTimes(2)
  })

  it('목록 조회가 500이면 빈 목록 대신 오류와 재시도를 보여준다', async () => {
    const user = userEvent.setup()
    api.listRooms.mockRejectedValueOnce(new ApiError('서버 오류', '잠시 후 다시 시도해 주세요.', 500))
    renderChat('/chat')

    // "대화가 없습니다" 로 위장하지 않는다 — 이게 이 화면의 원래 버그였다.
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('대화 기록을 불러오지 못했습니다.')
    expect(screen.queryByText(/대화가 없습니다/)).not.toBeInTheDocument()

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

  it('답변을 기다리는 중에 다른 대화로 옮기면 그 방에는 작성중 표시가 없다', async () => {
    const user = userEvent.setup()
    const send = deferred<{ answer: string; response_time_ms: number }>()
    api.sendChat.mockReturnValueOnce(send.promise)
    renderChat('/chat/room-a')

    await screen.findByText('room-a 질문')
    await user.type(await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...'), '질문')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await waitFor(() => expect(typingIndicator()).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))

    // 이게 원래 버그였다 — room-a 의 요청인데 room-b 에서 '작성중' 이 보였다.
    expect(await screen.findByText('room-b 질문')).toBeInTheDocument()
    expect(typingIndicator()).not.toBeInTheDocument()
    // 대신 사이드바가 "저쪽에서 돌고 있다" 를 알린다.
    expect(generatingRooms()).toEqual(['첫 번째 대화'])

    send.resolve({ answer: '테스트 답변', response_time_ms: 10 })
    // 답변은 room-a 에 저장될 뿐, 보고 있는 room-b 에는 붙지 않는다.
    await waitFor(() => {
      expect(api.addMessage).toHaveBeenCalledWith('room-a', 'ASSISTANT', '테스트 답변', 10)
    })
    expect(screen.queryByText('테스트 답변')).not.toBeInTheDocument()
  })

  it('답변이 붙으면 저장이 끝나기 전이어도 봇 말풍선은 하나만 보인다', async () => {
    const user = userEvent.setup()
    // 15자를 넘겨 타이핑 연출을 타게 한다 — 짧은 답변은 즉시 표시돼 이 창을 재현하지 못한다.
    const answer = '보증금 반환은 임대차 종료 후 청구할 수 있습니다. 우선 내용증명을 보내세요.'
    const saveAnswer = deferred<unknown>()
    // ASSISTANT 저장만 붙잡는다. USER 저장을 막으면 sendChat 까지 가지도 못한다.
    api.addMessage.mockImplementation((_roomId: string, role: string) =>
      role === 'ASSISTANT'
        ? saveAnswer.promise
        : Promise.resolve({
            id: 'stored-message',
            role,
            content: '저장됨',
            created_at: '2026-07-24T10:00:00Z',
          }),
    )
    api.sendChat.mockResolvedValueOnce({ answer, response_time_ms: 10 })
    renderChat('/chat/room-a')

    await screen.findByText('room-a 질문')
    await user.type(await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...'), '질문')
    await user.click(screen.getByRole('button', { name: '전송' }))

    // 답변 말풍선이 붙은 시점 — 타이핑은 시작 전이고 ASSISTANT 저장은 아직 대기 중이다.
    await waitFor(() => {
      expect(api.addMessage).toHaveBeenCalledWith('room-a', 'ASSISTANT', answer, 10)
    })
    // 저장이 안 끝났으니 sending 은 여전히 true 다(사이드바 점이 그 증거).
    expect(generatingRooms()).toEqual(['첫 번째 대화'])

    // 이게 원래 버그였다 — 저장이 끝날 때까지 인디케이터가 남아, 커서만 있는 빈 말풍선과
    // 함께 봇 말풍선이 두 개로 보였다.
    const thread = within(screen.getByTestId('message-scroll'))
    expect(thread.getAllByText(`${BRAND.name} 봇`)).toHaveLength(1)
    expect(typingIndicator()).not.toBeInTheDocument()

    saveAnswer.resolve({ id: 'stored-answer' })

    // 저장까지 끝나면 사이드바 점도 사라지고, 인디케이터는 계속 없다.
    await waitFor(() => expect(generatingRooms()).toEqual([]))
    expect(typingIndicator()).not.toBeInTheDocument()
  })

  it('첫 채팅에서 방을 만드는 동안 대기 표시가 깜빡이지 않는다', async () => {
    const user = userEvent.setup()
    const saveQuestion = deferred<unknown>()
    // 답변도 붙잡아 둔다 — 바로 도착하면 URL 전환 직후 상태가 '대기 중' 이 아니게 된다.
    const send = deferred<{ answer: string; response_time_ms: number }>()
    api.sendChat.mockReturnValueOnce(send.promise)
    // USER 저장을 붙잡아 "방 생성 완료 ~ URL 전환 직전" 구간을 열어 둔다.
    api.addMessage.mockImplementation((_roomId: string, role: string) =>
      role === 'USER'
        ? saveQuestion.promise
        : Promise.resolve({
            id: 'stored-message',
            role,
            content: '저장됨',
            created_at: '2026-07-24T10:00:00Z',
          }),
    )
    renderChat('/chat')

    const composer = await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...')
    await user.type(composer, '질문')
    await user.click(screen.getByRole('button', { name: '전송' }))

    // 방은 만들어졌고 질문 저장 중 — URL 은 아직 새 대화(/chat)다.
    await waitFor(() => {
      expect(api.addMessage).toHaveBeenCalledWith('room-new', 'USER', '질문')
    })
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/chat$/)

    // 이게 원래 버그였다 — 대기 표시를 URL 전환보다 먼저 새 방으로 옮겨서, 이 구간에는
    // 어느 쪽도 "지금 보는 방" 이 아니게 됐다. 인디케이터가 사라지고 입력창 안내가
    // '다른 대화에서...' 로 바뀌며 첫 채팅마다 화면이 깜빡였다.
    expect(typingIndicator()).toBeInTheDocument()
    expect(composer).toHaveAttribute('placeholder', '법률적인 상황을 설명해주세요...')

    saveQuestion.resolve({ id: 'stored-question' })

    // URL 전환 뒤에도 대기 표시는 끊기지 않고 이어진다(답변은 아직 오지 않았다).
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-new'))
    expect(typingIndicator()).toBeInTheDocument()
    expect(composer).toHaveAttribute('placeholder', '법률적인 상황을 설명해주세요...')

    const answer = '테스트 답변'
    send.resolve({ answer, response_time_ms: 10 })

    // 답변이 붙고 대기 표시도 정리된다. findByText 는 쓰지 않는다 — 타이핑이 끝나면
    // 스트리밍 span 이 마크다운 렌더로 교체돼, 먼저 잡은 노드가 분리된 상태로 넘어온다.
    await waitFor(() => expect(screen.getByText(answer)).toBeInTheDocument())
    await waitFor(() => expect(generatingRooms()).toEqual([]))
  })

  it('다른 대화가 생성 중이면 이유를 밝히고 전송을 막는다', async () => {
    const user = userEvent.setup()
    const send = deferred<{ answer: string; response_time_ms: number }>()
    api.sendChat.mockReturnValueOnce(send.promise)
    renderChat('/chat/room-a')

    await screen.findByText('room-a 질문')
    await user.type(await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...'), '질문')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await waitFor(() => expect(typingIndicator()).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    await screen.findByText('room-b 질문')

    // 이유 없이 죽어 있는 입력창은 고장으로 보인다 — 입력창이 왜, 사이드바가 어디서 인지 말한다.
    const busy = screen.getByPlaceholderText('다른 대화에서 답변을 생성 중입니다...')
    expect(generatingRooms()).toEqual(['첫 번째 대화'])

    await user.type(busy, '다른 질문')
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
    expect(api.sendChat).toHaveBeenCalledTimes(1)

    send.resolve({ answer: '테스트 답변', response_time_ms: 10 })

    // 끝나면 안내가 사라지고 바로 보낼 수 있다.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '전송' })).toBeEnabled()
    })
    expect(screen.getByPlaceholderText('법률적인 상황을 설명해주세요...')).toBeInTheDocument()
    expect(generatingRooms()).toEqual([])
  })

  it('답변을 기다리는 중에 새 대화로 나가도 추천 주제 화면이 보인다', async () => {
    const user = userEvent.setup()
    const send = deferred<{ answer: string; response_time_ms: number }>()
    api.sendChat.mockReturnValueOnce(send.promise)
    renderChat('/chat/room-a')

    await screen.findByText('room-a 질문')
    await user.type(await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...'), '질문')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await waitFor(() => expect(typingIndicator()).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '+ 새 대화' }))

    // 예전엔 sending 이 전역이라 Hero 가 숨고 타이핑 점만 남은 빈 화면이 됐다.
    expect(await screen.findByRole('heading', { name: '무엇을 도와드릴까요?' })).toBeInTheDocument()
    expect(typingIndicator()).not.toBeInTheDocument()
    expect(generatingRooms()).toEqual(['첫 번째 대화'])
    // 눌러도 전송되지 않는 추천 질문은 비활성으로 보여준다.
    const example = '집주인이 갑자기 월세를 크게 올려달라고 합니다. 거절할 수 있나요?'
    expect(screen.getByRole('button', { name: example })).toBeDisabled()

    send.resolve({ answer: '테스트 답변', response_time_ms: 10 })
    await waitFor(() => {
      expect(api.addMessage).toHaveBeenCalledWith('room-a', 'ASSISTANT', '테스트 답변', 10)
    })
  })

  it('생성 중이던 대화로 돌아오면 작성중 표시가 다시 보이고 답변이 붙는다', async () => {
    const user = userEvent.setup()
    const send = deferred<{ answer: string; response_time_ms: number }>()
    api.sendChat.mockReturnValueOnce(send.promise)
    renderChat('/chat/room-a')

    await screen.findByText('room-a 질문')
    await user.type(await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...'), '질문')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await waitFor(() => expect(typingIndicator()).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    await screen.findByText('room-b 질문')
    await user.click(screen.getByRole('button', { name: /첫 번째 대화/ }))
    await screen.findByText('room-a 질문')

    expect(typingIndicator()).toBeInTheDocument()

    send.resolve({ answer: '테스트 답변', response_time_ms: 10 })

    // 방 조회 응답이 늦게 도착해도 방금 붙은 답변을 덮어쓰지 않는다.
    expect(await screen.findByText('테스트 답변')).toBeInTheDocument()
  })

  it('새 대화를 만드는 사이 다른 대화를 열면 새 방으로 끌고 가지 않는다', async () => {
    const user = userEvent.setup()
    const create = deferred<(typeof rooms)[number]>()
    api.createRoom.mockReturnValueOnce(create.promise)
    renderChat('/chat')

    const composer = await screen.findByPlaceholderText('법률적인 상황을 설명해주세요...')
    await user.type(composer, '첫 질문')
    await user.click(screen.getByRole('button', { name: '전송' }))

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    expect(await screen.findByText('room-b 질문')).toBeInTheDocument()

    create.resolve({
      id: 'room-new',
      title: '첫 질문',
      last_chat_at: today.toISOString(),
      updated_at: '2026-07-24T10:00:00Z',
    })

    await waitFor(() => {
      expect(api.sendChat).toHaveBeenCalled()
    })
    // 사용자가 이미 다른 대화를 보고 있다 — 만들어진 방으로 URL 을 빼앗지 않는다.
    expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-b')
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

describe('Chat 모바일 대화기록', () => {
  beforeEach(() => {
    mobileViewport()
  })

  it('사이드바 대신 떠 있는 액션을 보여주고 목록은 감춘다', async () => {
    renderChat('/chat')

    expect(await screen.findByRole('button', { name: '대화기록' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새 채팅' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '첫 번째 대화' })).not.toBeInTheDocument()
  })

  // 액션은 고지 바를 기준으로 밀어내는 게 아니라 그 '아래' 박스를 기준으로 뜬다. 문서 순서가
  // 뒤집히면(액션이 고지보다 앞) 다시 고지 위에 겹쳐 뜨고, 고지를 닫아도 제자리에 남는다.
  it('떠 있는 액션은 법적 고지보다 뒤에 온다', async () => {
    renderChat('/chat/room-a') // 고지는 대화를 보고 있을 때만 뜬다

    const actions = (await screen.findByRole('button', { name: '대화기록' }))
      .parentElement as HTMLElement
    const notice = screen.getByRole('note')

    expect(notice).toHaveTextContent('법적 고지')
    expect(notice.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('대화기록을 누르면 데스크탑과 같은 목록이 드로어에 담긴다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    await user.click(await screen.findByRole('button', { name: '대화기록' }))

    // 날짜 그룹·항목·새 대화·추천 주제까지 사이드바와 같은 구성이 드로어 안에 들어온다.
    const drawer = within(screen.getByRole('dialog', { name: '대화기록' }))
    expect(drawer.getByRole('heading', { name: '오늘' })).toBeInTheDocument()
    expect(drawer.getByRole('heading', { name: '어제' })).toBeInTheDocument()
    expect(drawer.getByRole('button', { name: '첫 번째 대화' })).toBeInTheDocument()
    expect(drawer.getByRole('button', { name: '+ 새 대화' })).toBeInTheDocument()
    expect(drawer.getByRole('button', { name: /추천 주제/ })).toBeInTheDocument()
    // 제목은 드로어 헤더가 그리므로 목록이 또 그리지 않는다.
    expect(drawer.queryByRole('heading', { name: '대화 기록' })).not.toBeInTheDocument()
  })

  it('대화를 고르면 드로어만 닫히고 채팅 내용이 그 대화로 바뀐다', async () => {
    const user = userEvent.setup()
    renderChat('/chat')

    await user.click(await screen.findByRole('button', { name: '대화기록' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '대화기록' })).getByRole('button', {
        name: '두 번째 대화',
      }),
    )

    expect(screen.queryByRole('dialog', { name: '대화기록' })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/chat/room-b')
    })
    expect(await screen.findByText('room-b 질문')).toBeInTheDocument()
  })

  it('드로어에서도 대화가 0건이면 같은 빈 상태를 보여준다', async () => {
    api.listRooms.mockResolvedValueOnce({ items: [], next_cursor: null })
    const user = userEvent.setup()
    renderChat('/chat')

    await user.click(await screen.findByRole('button', { name: '대화기록' }))

    expect(
      within(screen.getByRole('dialog', { name: '대화기록' })).getByText('대화가 없습니다.'),
    ).toBeInTheDocument()
  })

  it('드로어에서 목록 조회 실패는 빈 상태가 아니라 ErrorState 로 그린다', async () => {
    api.listRooms.mockRejectedValueOnce(
      new ApiError('서버 오류', '잠시 후 다시 시도해 주세요.', 500),
    )
    const user = userEvent.setup()
    renderChat('/chat')

    await user.click(await screen.findByRole('button', { name: '대화기록' }))

    const drawer = within(screen.getByRole('dialog', { name: '대화기록' }))
    expect(drawer.getByText('대화 기록을 불러오지 못했습니다.')).toBeInTheDocument()
    expect(drawer.queryByText('대화가 없습니다.')).not.toBeInTheDocument()
  })

  it('드로어의 + 새 대화 를 누르면 드로어가 닫힌다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')

    await user.click(await screen.findByRole('button', { name: '대화기록' }))
    await user.click(
      within(screen.getByRole('dialog', { name: '대화기록' })).getByRole('button', {
        name: '+ 새 대화',
      }),
    )

    expect(screen.queryByRole('dialog', { name: '대화기록' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/chat$/))
  })

  it('떠 있는 새 채팅 버튼은 드로어를 열지 않고 바로 새 대화로 간다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')

    await user.click(await screen.findByRole('button', { name: '새 채팅' }))

    expect(screen.queryByRole('dialog', { name: '대화기록' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/chat$/))
  })

  it('아래로 스크롤하면 액션이 비켜났다가 위로 올리면 돌아온다', async () => {
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    const actions = screen.getByRole('button', { name: '대화기록' }).parentElement as HTMLElement
    expect(actions).toHaveAttribute('aria-hidden', 'false')

    const thread = screen.getByTestId('message-scroll')
    fireEvent.scroll(thread, { target: { scrollTop: 300 } })
    await waitFor(() => expect(actions).toHaveAttribute('aria-hidden', 'true'))

    fireEvent.scroll(thread, { target: { scrollTop: 120 } })
    await waitFor(() => expect(actions).toHaveAttribute('aria-hidden', 'false'))
  })

  // 빈 화면도 자체 스크롤 컨테이너다 — 연결을 빠뜨리면 버튼이 Hero 를 계속 덮는다.
  it('새 채팅 화면에서도 스크롤하면 액션이 비켜난다', async () => {
    renderChat('/chat')

    const actions = (await screen.findByRole('button', { name: '대화기록' }))
      .parentElement as HTMLElement
    const empty = screen.getByRole('heading', { name: '무엇을 도와드릴까요?' })
      .parentElement?.parentElement as HTMLElement

    fireEvent.scroll(empty, { target: { scrollTop: 300 } })
    await waitFor(() => expect(actions).toHaveAttribute('aria-hidden', 'true'))

    fireEvent.scroll(empty, { target: { scrollTop: 100 } })
    await waitFor(() => expect(actions).toHaveAttribute('aria-hidden', 'false'))
  })
})
