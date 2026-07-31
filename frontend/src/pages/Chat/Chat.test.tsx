import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ApiError } from '../../api/client'
import { BRAND } from '../../config/env'
import { showToast } from '../../components/Toast/toastStore'
import { Chat } from './Chat'

const api = vi.hoisted(() => ({
  listRooms: vi.fn(),
  listMessages: vi.fn(),
  createRoom: vi.fn(),
  addMessage: vi.fn(),
  updateMessage: vi.fn(),
  updateRoomTitle: vi.fn(),
  deleteRoom: vi.fn(),
  sendChat: vi.fn(),
  attachDocument: vi.fn(),
  detachDocument: vi.fn(),
  startAnalysis: vi.fn(),
  getAnalysis: vi.fn(),
}))

vi.mock('../../api/chatHistory', () => ({
  listRooms: api.listRooms,
  listMessages: api.listMessages,
  createRoom: api.createRoom,
  addMessage: api.addMessage,
  updateMessage: api.updateMessage,
  updateRoomTitle: api.updateRoomTitle,
  deleteRoom: api.deleteRoom,
  attachDocument: api.attachDocument,
  detachDocument: api.detachDocument,
  ROOM_TITLE_MAX: 200,
}))
// 거부 토스트가 몇 번 떴는지 세려면 실물 대신 스파이가 필요하다(나머지는 그대로 쓴다).
vi.mock('../../components/Toast/toastStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/Toast/toastStore')>()),
  showToast: vi.fn(),
}))
vi.mock('../../api/chat', () => ({ sendChat: api.sendChat }))
vi.mock('../../api/analyses', () => ({
  startAnalysis: api.startAnalysis,
  getAnalysis: api.getAnalysis,
}))
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

function chatTree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/chat/:chatId?" element={<ChatRoute />} />
      </Routes>
    </MemoryRouter>
  )
}

function renderChat(path: string) {
  return render(chatTree(path))
}

/** StrictMode 로 감싼 렌더 — updater·effect 가 두 번 실행되는 개발 모드 동작을 재현한다. */
function renderChatStrict(path: string) {
  return render(<StrictMode>{chatTree(path)}</StrictMode>)
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

let objectUrlSeq = 0

beforeAll(() => {
  HTMLElement.prototype.scrollTo = vi.fn()
  desktopMatchMedia = window.matchMedia // setup.ts 의 기본 스텁(= 데스크탑)
  // jsdom 에는 objectURL 이 없다 — 이미지 첨부 썸네일이 이걸 쓴다.
  // 호출마다 다른 값을 준다 — 같은 문자열이면 "어느 URL 이 반납됐는가" 를 구분할 수 없다.
  URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrlSeq}`)
  URL.revokeObjectURL = vi.fn()
})

/** 마지막으로 만들어진 objectURL. 반납 여부를 그 값으로 확인한다. */
const lastObjectUrl = () => (URL.createObjectURL as Mock).mock.results.at(-1)?.value as string

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
  api.updateMessage.mockResolvedValue({
    id: 'stored-message',
    role: 'ASSISTANT',
    content: '교체됨',
    created_at: '2026-07-24T10:00:00Z',
  })
  api.updateRoomTitle.mockResolvedValue({ ...rooms[0], title: '수정된 대화' })
  api.deleteRoom.mockResolvedValue(rooms[0])
  api.sendChat.mockResolvedValue({ answer: '테스트 답변', response_time_ms: 10 })
  api.startAnalysis.mockResolvedValue({ id: 'job-1', status: 'QUEUED' })
  api.getAnalysis.mockResolvedValue({ id: 'job-1', status: 'SUCCEEDED' })
  api.attachDocument.mockImplementation(async (roomId: string) => ({
    ...rooms[0],
    id: roomId,
    analysis_job_id: 'job-1',
    analysis_file_name: '계약서.pdf',
    analysis_file_names: ['계약서.pdf'],
  }))
  api.detachDocument.mockImplementation(async (roomId: string) => ({
    ...rooms[0],
    id: roomId,
    analysis_job_id: null,
  }))
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
    expect(api.addMessage).toHaveBeenCalledWith('room-new', 'USER', question, undefined, [])
    // 방 id 를 함께 넘겨야 서버가 그 방에 첨부된 계약서를 답변 근거에 넣을 수 있다.
    expect(api.sendChat).toHaveBeenCalledWith(question, [], 'room-new', false)
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
    expect(api.addMessage).toHaveBeenCalledWith('room-new', 'USER', '첫 질문', undefined, [])
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
    api.listRooms.mockRejectedValueOnce(
      new ApiError('서버 오류', '잠시 후 다시 시도해 주세요.', 500),
    )
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
      expect(api.addMessage).toHaveBeenCalledWith('room-new', 'USER', '질문', undefined, [])
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

describe('Chat 파일 첨부', () => {
  const placeholder = '법률적인 상황을 설명해주세요...'

  /** 입력창의 숨은 file input 에 파일을 흘려 넣는다. */
  async function attach(user: ReturnType<typeof userEvent.setup>, ...files: File[]) {
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, files)
  }

  const pdf = () => new File(['a'], '계약서.pdf', { type: 'application/pdf' })
  const jpg = () => new File(['b'], '등기부.jpg', { type: 'image/jpeg' })

  it('파일을 고르는 것만으로는 업로드하지 않는다 — 전송해야 올라간다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf(), jpg())

    // 프리뷰에는 보이지만 아직 서버로 간 것은 없다 — 그래야 ✕ 가 취소할 대상이 분명하다.
    expect(await screen.findByText('계약서.pdf')).toBeInTheDocument()
    expect(screen.getByText('등기부.jpg')).toBeInTheDocument()
    expect(api.startAnalysis).not.toHaveBeenCalled()
  })

  it('전송 전에는 첨부를 하나씩 뺄 수 있다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf(), jpg())
    await user.click(await screen.findByRole('button', { name: '등기부.jpg 제거' }))

    expect(screen.queryByText('등기부.jpg')).not.toBeInTheDocument()
    expect(screen.getByText('계약서.pdf')).toBeInTheDocument()
  })

  it('전송하면 여러 파일을 한 건의 분석으로 올리고 알림은 만들지 않는다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf(), jpg())
    await user.type(await screen.findByPlaceholderText(placeholder), '계약서 분석해줘')
    await user.click(screen.getByRole('button', { name: '전송' }))

    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalledTimes(1))
    const [files, , options] = api.startAnalysis.mock.calls[0]
    expect(files.map((f: File) => f.name)).toEqual(['계약서.pdf', '등기부.jpg'])
    expect(options).toMatchObject({ notify: false })

    // 첨부를 방에 붙인 뒤에야 질문이 나간다 — 순서가 뒤집히면 계약서 없이 답한다.
    await waitFor(() => expect(api.attachDocument).toHaveBeenCalledWith('room-a', 'job-1'))
    await waitFor(() => expect(api.sendChat).toHaveBeenCalled())
    expect(await screen.findByText('테스트 답변')).toBeInTheDocument()
  })

  it('보낸 첨부는 사용자 말풍선에 남고 입력창 프리뷰에서는 사라진다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), '이거 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))

    await screen.findByText('테스트 답변')
    // 프리뷰가 아니라 말풍선 안에 하나만 남아 있어야 한다(두 곳에 보이면 두 번 보낸 것처럼 읽힌다).
    expect(screen.getAllByText('계약서.pdf')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: '계약서.pdf 제거' })).not.toBeInTheDocument()
    // 저장 요청에도 첨부가 실린다 — 새로고침 뒤에도 말풍선에 남아야 한다.
    expect(api.addMessage).toHaveBeenCalledWith('room-a', 'USER', '이거 봐줘', undefined, [
      { name: '계약서.pdf', kind: 'pdf' },
    ])
  })

  it('첨부만 두고 보내면 기본 질문으로 대신 묻는다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.click(screen.getByRole('button', { name: '전송' }))

    // 빈 문자열은 서버(min_length=1)가 막으므로 무엇을 물었는지 문구로 남긴다.
    await waitFor(() =>
      expect(api.sendChat).toHaveBeenCalledWith(
        '첨부한 계약서를 분석해 주세요.',
        expect.anything(),
        'room-a',
        false,
      ),
    )
  })

  it('첨부 분석이 실패해도 쓴 질문이 있으면 계약서 없이 답하고 사유를 경고 줄로 알린다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '개인정보가 남아 있습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), '분석해줘')
    await user.click(screen.getByRole('button', { name: '전송' }))

    // 첨부가 깨졌다고 질문까지 버리지 않는다 — 예전에는 여기서 대화가 끊겨 다시 타이핑해야 했다.
    // attachment_failed 를 켜 보내야 모델이 계약서를 본 척하지 않는다.
    await waitFor(() =>
      expect(api.sendChat).toHaveBeenCalledWith('분석해줘', expect.anything(), 'room-a', true),
    )
    expect(await screen.findByText('테스트 답변')).toBeInTheDocument()
    // "답변 생성 실패" 로 뭉개면 사용자가 파일을 고칠 생각을 못 한다.
    expect(screen.getByText('개인정보가 남아 있습니다.')).toBeInTheDocument()
  })

  it('첨부만 보냈는데 분석이 실패하면 예전대로 오류 말풍선만 남는다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '개인정보가 남아 있습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.click(screen.getByRole('button', { name: '전송' }))

    // 되살릴 질문이 없다. 계약서 없이 "계약서를 분석해 주세요" 에 답하면 지어낸 답이 된다.
    expect(await screen.findByText('개인정보가 남아 있습니다.')).toBeInTheDocument()
    expect(api.sendChat).not.toHaveBeenCalled()
  })

  it('첨부 없이 보낸 질문은 attachment_failed 를 켜지 않는다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await user.type(await screen.findByPlaceholderText(placeholder), '전세금 반환')
    await user.click(screen.getByRole('button', { name: '전송' }))

    await waitFor(() =>
      expect(api.sendChat).toHaveBeenCalledWith('전세금 반환', expect.anything(), 'room-a', false),
    )
    expect(screen.queryByRole('button', { name: /파일 다시 첨부/ })).not.toBeInTheDocument()
  })

  it('계약서 없이 답한 뒤 파일 다시 첨부하면 그 파일을 다시 올리고 답을 교체한다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서 처리 서버가 응답하지 않습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), '이거 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서 처리 서버가 응답하지 않습니다.')

    api.sendChat.mockResolvedValueOnce({ answer: '계약서를 본 답변', response_time_ms: 10 })
    await user.click(screen.getByRole('button', { name: /파일 다시 첨부/ }))

    // 재시도가 파일을 다시 올려야 한다 — 안 그러면 영영 계약서 없는 답만 쌓인다.
    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.attachDocument).toHaveBeenCalledWith('room-a', 'job-1'))
    expect(await screen.findByText('계약서를 본 답변')).toBeInTheDocument()
    // 계약서 없이 답한 말풍선과 경고 줄은 자리를 내준다(둘이 남으면 어느 쪽이 맞는지 알 수 없다).
    expect(screen.queryByText('테스트 답변')).not.toBeInTheDocument()
    expect(screen.queryByText('계약서 처리 서버가 응답하지 않습니다.')).not.toBeInTheDocument()
  })

  it('첨부만 보내고 실패한 뒤 다시 생성하면 그 파일을 다시 올린다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서를 분석하지 못했습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서를 분석하지 못했습니다.')

    await user.click(screen.getByRole('button', { name: /다시 생성/ }))

    // 파일 없이 되물으면 계약서를 못 본 채 일반 답변이 나가고, 사용자는 그걸 알 길이 없다.
    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.attachDocument).toHaveBeenCalledWith('room-a', 'job-1'))
    expect(await screen.findByText('테스트 답변')).toBeInTheDocument()
  })

  // ── 첨부는 그것을 고른 대화의 것이다 ──────────────────────────────
  // 예전에는 프리뷰·in-flight·업로드 플래그가 모두 전역이라 A 에서 고른 파일이 B 로 넘어갔다.

  it('다른 대화로 옮기면 아직 보내지 않은 첨부를 버리고 그 방 전송에 싣지 않는다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    expect(await screen.findByText('계약서.pdf')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    await screen.findByText('room-b 질문')

    // A 에서 고른 파일이 B 의 입력창에 남아 있으면 안 된다.
    expect(screen.queryByText('계약서.pdf')).not.toBeInTheDocument()

    await user.type(await screen.findByPlaceholderText(placeholder), 'B 질문')
    await user.click(screen.getByRole('button', { name: '전송' }))

    await waitFor(() =>
      expect(api.sendChat).toHaveBeenCalledWith('B 질문', expect.anything(), 'room-b', false),
    )
    // B 로 따라와 올라가면 사용자는 올린 적 없는 계약서로 답을 받는다.
    expect(api.startAnalysis).not.toHaveBeenCalled()
    expect(api.addMessage).toHaveBeenCalledWith('room-b', 'USER', 'B 질문', undefined, [])
  })

  it('버려진 첨부의 썸네일 URL 은 대화를 옮기는 그 자리에서 반납한다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, jpg())
    await screen.findByText('등기부.jpg')
    const url = lastObjectUrl()
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url)

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    await screen.findByText('room-b 질문')

    // 화면을 떠날 때까지 들고 있으면 원본 File 이 통째로 메모리에 남는다.
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith(url))
  })

  it('첨부를 빼면 그 썸네일 URL 을 그 자리에서 반납한다', async () => {
    const user = userEvent.setup()
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, jpg())
    await screen.findByText('등기부.jpg')
    const url = lastObjectUrl()

    await user.click(screen.getByRole('button', { name: '등기부.jpg 제거' }))

    expect(screen.queryByText('등기부.jpg')).not.toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it('StrictMode 에서도 썸네일 URL 과 거부 토스트가 한 번씩만 생긴다', async () => {
    const user = userEvent.setup()
    renderChatStrict('/chat/room-a')
    await screen.findByText('room-a 질문')

    // 같은 파일 두 개 — 하나는 담기고 하나는 '중복' 으로 거부된다.
    const sameJpg = () => new File(['b'], '등기부.jpg', { type: 'image/jpeg', lastModified: 1 })
    await attach(user, sameJpg(), sameJpg())
    expect(await screen.findByText('등기부.jpg')).toBeInTheDocument()

    // updater 안에서 부수효과를 돌리면 StrictMode 의 재실행 때문에 둘 다 두 번씩 일어난다
    // (URL 하나는 영영 반납되지 않고, 토스트는 같은 말을 두 번 한다).
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('이미 추가한 파일입니다'),
      'info',
    )
  })

  it('A 가 업로드하는 동안 B 로 옮겨도 B 의 참고 중 배지는 B 의 계약서를 가리킨다', async () => {
    const user = userEvent.setup()
    api.listRooms.mockResolvedValueOnce({
      items: [
        rooms[0],
        {
          ...rooms[1],
          analysis_job_id: 'job-b',
          analysis_file_name: 'B계약서.pdf',
          analysis_file_names: ['B계약서.pdf'],
        },
      ],
      next_cursor: null,
    })
    const analysis = deferred<{ id: string; status: string }>()
    api.startAnalysis.mockReturnValueOnce(analysis.promise)
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), '이거 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalledTimes(1))

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    await screen.findByText('room-b 질문')

    // 예전엔 업로드 플래그가 전역이라 B 의 배지 동기화까지 통째로 걸러졌다 — 배지가 비었다.
    expect(await screen.findByText(/B계약서\.pdf.*참고 중/)).toBeInTheDocument()

    analysis.resolve({ id: 'job-1', status: 'QUEUED' })
    // A 의 첨부가 끝나도 보고 있는 B 의 배지는 그대로다.
    await waitFor(() => expect(api.attachDocument).toHaveBeenCalledWith('room-a', 'job-1'))
    expect(screen.getByText(/B계약서\.pdf.*참고 중/)).toBeInTheDocument()
  })

  it('A 에서 첨부에 실패한 파일이 B 의 다시 생성에 실려 나가지 않는다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서를 분석하지 못했습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), '이거 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서를 분석하지 못했습니다.')
    expect(api.startAnalysis).toHaveBeenCalledTimes(1)

    // B 로 옮겨 답변 생성이 실패하면 그 자리의 '다시 생성' 은 B 의 질문만 다시 물어야 한다.
    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    await screen.findByText('room-b 질문')
    api.sendChat.mockRejectedValueOnce(new ApiError('서버 오류', '잠시 후 다시', 500))
    await user.type(await screen.findByPlaceholderText(placeholder), 'B 질문')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.')

    await user.click(screen.getByRole('button', { name: /다시 생성/ }))

    await waitFor(() => expect(api.sendChat).toHaveBeenCalledTimes(3))
    // A 의 파일이 B 에 올라가면 B 는 남의 계약서를 근거로 답하게 된다.
    expect(api.startAnalysis).toHaveBeenCalledTimes(1)
    expect(api.attachDocument).not.toHaveBeenCalled()
  })

  // ── 첨부 실패 답변의 교체 ────────────────────────────────────────

  it('재시도가 성공하면 실패 답변을 DB 에서도 갈아끼운다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서 처리 서버가 응답하지 않습니다.' },
    })
    const assistantSaves = () =>
      api.addMessage.mock.calls.filter(([, role]) => role === 'ASSISTANT').length
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), '이거 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서 처리 서버가 응답하지 않습니다.')
    await waitFor(() =>
      expect(api.addMessage).toHaveBeenCalledWith('room-a', 'ASSISTANT', '테스트 답변', 10),
    )

    api.sendChat.mockResolvedValueOnce({ answer: '계약서를 본 답변', response_time_ms: 20 })
    await user.click(screen.getByRole('button', { name: /파일 다시 첨부/ }))

    // 저장된 그 행을 교체한다 — 새로 쌓으면 새로고침 후 답변이 둘로 보인다(원래 버그).
    await waitFor(() =>
      expect(api.updateMessage).toHaveBeenCalledWith(
        'room-a',
        'stored-message',
        '계약서를 본 답변',
        20,
      ),
    )
    expect(assistantSaves()).toBe(1)
    expect(await screen.findByText('계약서를 본 답변')).toBeInTheDocument()
  })

  it('재시도 요청의 맥락에는 계약서를 못 읽고 답한 말풍선이 들어가지 않는다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서 처리 서버가 응답하지 않습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), '이거 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서 처리 서버가 응답하지 않습니다.')

    await user.click(screen.getByRole('button', { name: /파일 다시 첨부/ }))

    await waitFor(() => expect(api.sendChat).toHaveBeenCalledTimes(2))
    const retryHistory = api.sendChat.mock.calls[1][1] as { content: string }[]
    const contents = retryHistory.map((turn) => turn.content)
    // 남겨두면 모델이 "앞에서 설명한 내용은 반복하지 마라" 를 그 실패 답변에 적용한다.
    expect(contents).not.toContain('테스트 답변')
    expect(contents).toContain('이거 봐줘')
  })

  it('일반적인 답변 실패의 다시 생성은 예전처럼 새 답변을 저장한다', async () => {
    const user = userEvent.setup()
    api.sendChat.mockRejectedValueOnce(new ApiError('서버 오류', '잠시 후 다시', 500))
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await user.type(await screen.findByPlaceholderText(placeholder), '전세금 반환')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.')

    await user.click(screen.getByRole('button', { name: /다시 생성/ }))

    // 오류 버블은 DB 에 저장된 적이 없다 — 갈아끼울 행이 없으므로 그대로 새로 쌓는다.
    await waitFor(() =>
      expect(api.addMessage).toHaveBeenCalledWith('room-a', 'ASSISTANT', '테스트 답변', 10),
    )
    expect(api.updateMessage).not.toHaveBeenCalled()
  })

  // ── 재시도는 '그 실패한 턴' 의 것이다 ──────────────────────────────
  // 예전에는 재시도 질문이 전역 lastQuestion, 파일이 방 단위 목록이라 둘이 따로 놀았다.
  // 같은 방에서 첨부 실패 뒤 다른 질문을 보내면 옛 계약서와 새 질문이 함께 나갈 수 있었다 —
  // 엉뚱한 계약서를 근거로 한 답이므로 반드시 막아야 한다.

  it('첨부 실패 뒤 같은 방에서 새 질문을 보내면 그 턴의 재시도 버튼이 사라진다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서를 분석하지 못했습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), 'A 계약서 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서를 분석하지 못했습니다.')
    expect(screen.getByRole('button', { name: /파일 다시 첨부/ })).toBeInTheDocument()

    await user.type(await screen.findByPlaceholderText(placeholder), '질문 B')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await waitFor(() =>
      expect(api.sendChat).toHaveBeenCalledWith('질문 B', expect.anything(), 'room-a', false),
    )

    // 무슨 일이 있었는지는 그 턴의 기록이라 문구로 남는다. 다만 버튼은 사라져야 한다 —
    // 남겨두면 계약서 A 와 질문 B 가 함께 나간다.
    expect(screen.getByText('계약서를 분석하지 못했습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /파일 다시 첨부/ })).not.toBeInTheDocument()
    // 질문 B 가 계약서 A 를 다시 올리지도 않는다.
    expect(api.startAnalysis).toHaveBeenCalledTimes(1)
  })

  it('파일 다시 첨부는 실패했던 그 턴의 질문과 파일만 다시 보낸다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서를 분석하지 못했습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, pdf())
    await user.type(await screen.findByPlaceholderText(placeholder), 'A 계약서 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서를 분석하지 못했습니다.')

    await user.click(screen.getByRole('button', { name: /파일 다시 첨부/ }))

    await waitFor(() => expect(api.sendChat).toHaveBeenCalledTimes(2))
    // 전역 '마지막 질문' 이 아니라 이 턴의 질문이다.
    expect(api.sendChat.mock.calls[1][0]).toBe('A 계약서 봐줘')
    await waitFor(() => expect(api.startAnalysis).toHaveBeenCalledTimes(2))
    const [retried] = api.startAnalysis.mock.calls[1]
    expect(retried.map((f: File) => f.name)).toEqual(['계약서.pdf'])
  })

  it('답변 생성 실패의 다시 생성도 실패했던 그 질문을 다시 보낸다', async () => {
    const user = userEvent.setup()
    api.sendChat.mockRejectedValueOnce(new ApiError('서버 오류', '잠시 후 다시', 500))
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await user.type(await screen.findByPlaceholderText(placeholder), '전세금은 언제 돌려받나요?')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.')

    await user.click(screen.getByRole('button', { name: /다시 생성/ }))

    await waitFor(() => expect(api.sendChat).toHaveBeenCalledTimes(2))
    expect(api.sendChat.mock.calls[1][0]).toBe('전세금은 언제 돌려받나요?')
  })

  it('방을 옮기면 재시도 권한과 함께 그 파일·썸네일 URL 을 놓아준다', async () => {
    const user = userEvent.setup()
    api.getAnalysis.mockResolvedValueOnce({
      id: 'job-1',
      status: 'FAILED',
      error: { message: '계약서를 분석하지 못했습니다.' },
    })
    renderChat('/chat/room-a')
    await screen.findByText('room-a 질문')

    await attach(user, jpg()) // 이미지라야 썸네일 objectURL 이 생긴다
    await screen.findByText('등기부.jpg')
    const url = lastObjectUrl()
    await user.type(await screen.findByPlaceholderText(placeholder), '이거 봐줘')
    await user.click(screen.getByRole('button', { name: '전송' }))
    await screen.findByText('계약서를 분석하지 못했습니다.')
    // 재시도가 살아 있는 동안에는 말풍선이 그 썸네일을 그린다.
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(url)

    await user.click(screen.getByRole('button', { name: /두 번째 대화/ }))
    await screen.findByText('room-b 질문')

    // 화면 어디에서도 쓰지 않게 됐으면 그 자리에서 반납한다(원본 File 도 함께 놓아준다).
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith(url))

    // 돌아와도 다시 올릴 파일이 없으므로 재시도 버튼은 없다.
    await user.click(screen.getByRole('button', { name: /첫 번째 대화/ }))
    await screen.findByText('room-a 질문')
    expect(screen.queryByRole('button', { name: /파일 다시 첨부/ })).not.toBeInTheDocument()
  })

  it('기록에서 되살아난 메시지의 첨부도 말풍선에 보인다', async () => {
    api.listMessages.mockResolvedValue({
      items: [
        {
          id: 'm1',
          role: 'USER',
          content: '계약서 분석해줘',
          created_at: '2026-07-24T09:00:00Z',
          attachments: [{ name: '계약서.pdf', kind: 'pdf' }],
        },
      ],
      next_cursor: null,
    })
    renderChat('/chat/room-a')

    expect(await screen.findByText('계약서 분석해줘')).toBeInTheDocument()
    expect(screen.getByText('계약서.pdf')).toBeInTheDocument()
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
    const empty = screen.getByRole('heading', { name: '무엇을 도와드릴까요?' }).parentElement
      ?.parentElement as HTMLElement

    fireEvent.scroll(empty, { target: { scrollTop: 300 } })
    await waitFor(() => expect(actions).toHaveAttribute('aria-hidden', 'true'))

    fireEvent.scroll(empty, { target: { scrollTop: 100 } })
    await waitFor(() => expect(actions).toHaveAttribute('aria-hidden', 'false'))
  })
})
