import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { sendChat, type ChatTurn } from '../../api/chat'
import { addMessage, createRoom, listMessages, listRooms, type ChatRoom } from '../../api/chatHistory'
import { isRetryable } from '../../api/apiErrorHandler'
import { Drawer } from '../../components/Drawer/Drawer'
import { ErrorState } from '../../components/ErrorState/ErrorState'
import { Close, Info } from '../../components/icons'
import { isAuthConfigured } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useHideOnScrollDown } from '../../hooks/useHideOnScrollDown'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { ChatComposer } from './ChatComposer'
import { ChatHistoryPanel } from './ChatHistoryPanel'
import { ChatMobileActions } from './ChatMobileActions'
import { ChatSuggestTopics } from './ChatSuggestTopics'
import { DeleteRoomModal } from './DeleteRoomModal'
import { EmptyState } from './EmptyState'
import { MessageList } from './MessageList'
import { RenameRoomModal } from './RenameRoomModal'
import { groupRoomsByDate } from './roomGroups'
import { topicById } from './topics'
import type { Message } from './types'
import styles from './Chat.module.scss'

const MAX_LEN = 2000
const HISTORY_TURNS = 10 // RAG 에 함께 보내는 최근 맥락 수
const LEGAL_NOTICE_DISMISSED_KEY = 'homeshield:legal-notice-dismissed'

/** 아직 방이 없는 새 대화의 대기 키. 방 id 는 빈 문자열이 될 수 없어 충돌하지 않는다. */
const NEW_CHAT_KEY = ''
const roomKey = (roomId: string | null) => roomId ?? NEW_CHAT_KEY

/** 입력창 플레이스홀더 자리에 들어가므로 한 줄로 짧게 — 자세한 위치는 사이드바 점이 알린다. */
const BUSY_ELSEWHERE_NOTICE = '다른 대화에서 답변을 생성 중입니다...'

let _id = 0
const newId = () => `m${Date.now()}-${_id++}`

const toMessage = (r: { id: string; role: string; content: string }): Message => ({
  id: r.id,
  role: r.role === 'ASSISTANT' ? 'assistant' : 'user',
  content: r.content,
})

/**
 * 대화 영역을 막는 이유.
 * - `unavailable` — API 실패가 아니라 로그인/저장소 미설정. 다시 시도해도 결과가 같다.
 * - `failed` — 조회 실패. 이 화면은 대화 영역 전체가 실패로 덮이므로 공통 오류 모달을 끄고
 *   (`{ silent: true }`) 이 자리에서만 알린다 — 모달까지 띄우면 같은 말을 두 번 하고,
 *   닫고 나면 아무 안내도 남지 않는다. 재시도를 보일지는 공통 isRetryable 이 정한다.
 */
type ConversationBlock = { reason: 'unavailable' } | { reason: 'failed'; error: unknown } | null

/** 응답 자체를 못 받았을 때(ApiError 아님)만 쓰는 문구 — 그 밖엔 서버가 준 문구를 그대로 쓴다. */
const CONVERSATION_NETWORK_ERROR = '대화를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'

export function Chat() {
  const { isAuthed } = useAuth()
  const navigate = useNavigate()
  const { chatId } = useParams<{ chatId: string }>()
  const persistent = isAuthed && isAuthConfigured // 로그인 + Supabase 설정 시 DB 저장
  const activeRoomId = chatId ?? null

  // 좁은 화면에서는 사이드바 대신 드로어로 같은 목록을 보여준다. CSS 로 감추지 않고
  // 마운트 자체를 가르는 이유는 무한스크롤 sentinel 이 둘이 되면 안 되기 때문이다.
  const isMobile = useIsMobile()
  const [historyOpen, setHistoryOpen] = useState(false)
  // 떠 있는 액션은 대화 위에 겹치므로, 읽으려고 내릴 때는 비켜 준다.
  const { hidden: actionsHidden, onScroll: onThreadScroll, reveal: revealActions } =
    useHideOnScrollDown()

  // 방 목록(커서 페이지네이션)
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [roomsCursor, setRoomsCursor] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(persistent)
  const [loadingRooms, setLoadingRooms] = useState(false)
  // 실패 "여부"만 들고 있는다. 무슨 오류인지 해석하는 일은 공통 레이어 몫이다.
  const [roomsError, setRoomsError] = useState<unknown>(null)
  const [roomsReloadKey, setRoomsReloadKey] = useState(0)
  const [renameTarget, setRenameTarget] = useState<ChatRoom | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ChatRoom | null>(null)

  // 활성 대화 — URL 의 chatId 가 단일 기준이며, 메시지만 로컬 렌더링 상태로 둔다.
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [openingRoom, setOpeningRoom] = useState(false)
  const [conversationBlock, setConversationBlock] = useState<ConversationBlock>(null)
  const [messagesReloadKey, setMessagesReloadKey] = useState(0)
  const [followLatestRequest, setFollowLatestRequest] = useState(0)

  const [input, setInput] = useState('')
  // 답변 생성이 진행 중인 방들. 전역 boolean 이면 답변을 기다리는 도중 다른 방으로 옮겼을 때
  // 그 방에도 '작성중' 이 뜨고 입력창까지 잠긴다 — 대기 상태는 방에 묶여 있어야 한다.
  const [pendingRooms, setPendingRooms] = useState<ReadonlySet<string>>(() => new Set())
  // 추천 주제는 기본 펼침. 접으면 그만큼 대화 목록이 길어진다.
  const [suggestOpen, setSuggestOpen] = useState(true)
  // 고른 추천 주제(null = 기본 화면). 첫 화면 Hero 의 내용만 바꾸고 채팅은 만들지 않는다.
  const [topicId, setTopicId] = useState<string | null>(null)
  const [showLegalNotice, setShowLegalNotice] = useState(() => {
    try {
      return window.sessionStorage.getItem(LEGAL_NOTICE_DISMISSED_KEY) !== 'true'
    } catch {
      return true
    }
  })
  const lastQuestion = useRef('')
  const activeRoomIdRef = useRef<string | null>(activeRoomId)
  const createdRoomIdRef = useRef<string | null>(null)
  // 목록 무한스크롤의 스크롤 컨테이너. 사이드바·드로어 중 지금 마운트된 쪽이 채운다.
  const roomsScrollRef = useRef<HTMLDivElement>(null)
  const roomsSentinel = useRef<HTMLDivElement>(null)
  // pendingRooms 는 리렌더 후에야 반영된다 — 연타로 두 요청이 새는 걸 막으려면 즉시 잠가야 한다.
  const generatingRef = useRef(false)
  activeRoomIdRef.current = activeRoomId

  const setPending = useCallback((key: string, on: boolean) => {
    setPendingRooms((prev) => {
      if (prev.has(key) === on) return prev
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  // 지금 보고 있는 방이 생성 중인가 — 타이핑 인디케이터는 이 방의 것만 그린다.
  // 다른 방의 생성은 백그라운드에서 계속되고, 그 방으로 돌아오면 다시 '작성중' 이 보인다.
  const sending = pendingRooms.has(roomKey(activeRoomId))
  // 생성은 한 번에 하나만 한다. 다만 다른 방의 요청이라 이 방엔 '작성중' 이 없으므로,
  // 입력창을 그냥 잠그면 이유를 알 수 없다 — 잠그는 김에 왜 잠겼는지도 같이 말해준다.
  const busyElsewhere = pendingRooms.size > 0 && !sending

  /**
   * 답변 저장 후 그 방을 목록 맨 앞으로 올린다(백엔드가 last_chat_at 을 갱신한 것과 같은 결과).
   *
   * 예전엔 첫 페이지를 다시 불러왔는데, 그러면 스크롤로 이미 불러온 2페이지 이후가 통째로
   * 사라졌다. 정렬에 쓰는 last_chat_at 만 목록에서 직접 반영하면 같은 결과를 얻는다.
   */
  const touchRoom = useCallback((roomId: string) => {
    setRooms((prev) => {
      const hit = prev.find((r) => r.id === roomId)
      if (!hit) return prev // 아직 불러오지 않은 페이지의 방 — 다음 조회 때 제자리를 찾는다.
      return [
        { ...hit, last_chat_at: new Date().toISOString() },
        ...prev.filter((r) => r.id !== roomId),
      ]
    })
  }, [])

  /** 목록을 처음부터 다시 불러온다(키를 바꿔 아래 effect 를 다시 태운다). */
  const retryLoadRooms = useCallback(() => setRoomsReloadKey((key) => key + 1), [])

  useEffect(() => {
    let cancelled = false

    if (!persistent) {
      setInitializing(false)
      return
    }

    setInitializing(true)
    setRoomsError(null)
    void listRooms()
      .then((page) => {
        if (cancelled) return
        setRooms(page.items)
        setRoomsCursor(page.next_cursor)
      })
      .catch((error: unknown) => {
        // 원인 안내는 client.ts 의 공통 처리가 이미 했다. 여기선 "실패했다"만 기록한다.
        // 이걸 빼먹으면 빈 목록이 "아직 대화가 없어요" 로 보여 원인을 오해하게 만든다.
        if (cancelled) return
        setRooms([])
        setRoomsCursor(null)
        setRoomsError(error)
      })
      .finally(() => {
        if (!cancelled) setInitializing(false)
      })

    return () => {
      cancelled = true
    }
  }, [persistent, roomsReloadKey])

  /** 현재 대화의 메시지를 다시 불러온다. */
  const retryLoadMessages = useCallback(() => setMessagesReloadKey((key) => key + 1), [])

  // URL 의 chatId 가 현재 대화의 단일 기준이다. 직접 접근·새로고침·브라우저
  // 뒤로가기/앞으로가기로 값이 바뀔 때마다 해당 방을 다시 조회한다.
  useEffect(() => {
    let cancelled = false
    setInput('')
    setMessagesCursor(null)
    setLoadingOlder(false)
    setConversationBlock(null)

    // 첫 메시지로 방을 만든 직후에는 이미 화면과 DB에 사용자 메시지가 있으므로
    // URL 전환 때문에 다시 비우거나 중복 조회하지 않는다.
    if (activeRoomId && createdRoomIdRef.current === activeRoomId) {
      createdRoomIdRef.current = null
      setOpeningRoom(false)
      return
    }

    lastQuestion.current = ''
    setMessages([])

    if (!activeRoomId) {
      setOpeningRoom(false)
      return
    }

    if (!persistent) {
      setOpeningRoom(false)
      setConversationBlock({ reason: 'unavailable' })
      return
    }

    setOpeningRoom(true)
    // 실패하면 아래 ErrorState 가 서버 문구 그대로 알린다 — 공통 모달은 중복이라 끈다.
    void listMessages(activeRoomId, null, { silent: true })
      .then((page) => {
        if (cancelled) return
        setMessages((prev) => {
          const fetched = page.items.map(toMessage)
          // 조회하는 동안 도착한 답변은 남긴다. 위에서 이미 [] 로 비웠으므로 prev 에는 그 사이
          // 붙은 로컬 말풍선만 있다(로컬 id 는 `m…` 이라 DB id 와 겹치지 않는다). 그냥 덮어쓰면
          // 생성 중이던 방으로 돌아왔을 때 방금 붙은 답변이 사라진다.
          const ids = new Set(fetched.map((m) => m.id))
          return [...fetched, ...prev.filter((m) => !ids.has(m.id))]
        })
        setMessagesCursor(page.next_cursor)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setConversationBlock({ reason: 'failed', error }) // 문구·모달은 공통 처리가 맡는다.
      })
      .finally(() => {
        if (!cancelled) setOpeningRoom(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeRoomId, persistent, messagesReloadKey])

  // 방 목록 무한스크롤 — 목록 끝 sentinel.
  // 실패했으면 관찰을 멈춘다. sentinel 이 계속 보이는 상태라 그냥 두면 실패한 요청을
  // 무한히 다시 쏜다(오류 모달도 그만큼 다시 뜬다) — "다시 시도" 를 누를 때 재개한다.
  //
  // isMobile·historyOpen 이 의존성에 있는 이유: 목록이 사이드바에서 드로어로 옮겨가면
  // 두 ref 가 새 DOM 으로 바뀐다. 다시 실행하지 않으면 사라진 옛 노드를 계속 관찰한다.
  useEffect(() => {
    const sentinel = roomsSentinel.current
    const root = roomsScrollRef.current
    if (!sentinel || !root || !roomsCursor || roomsError !== null) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && roomsCursor && !loadingRooms) {
          setLoadingRooms(true)
          listRooms(roomsCursor)
            .then((page) => {
              setRooms((prev) => [...prev, ...page.items])
              setRoomsCursor(page.next_cursor)
            })
            // 이미 불러온 목록은 그대로 두고 아래에 안내만 붙인다.
            .catch((error: unknown) => setRoomsError(error))
            .finally(() => setLoadingRooms(false))
        }
      },
      { root, rootMargin: '120px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [roomsCursor, loadingRooms, roomsError, isMobile, historyOpen])

  // 넓어지면 열려 있던 드로어를 정리한다 — 사이드바가 돌아오는데 겹쳐 남으면 안 된다.
  useEffect(() => {
    if (!isMobile) setHistoryOpen(false)
  }, [isMobile])

  // 대화가 바뀌면 스크롤도 처음부터다 — 감춰둔 액션을 다시 꺼내지 않으면 들어간 채로 남는다.
  useEffect(() => {
    revealActions()
  }, [activeRoomId, revealActions])

  const closeHistory = useCallback(() => setHistoryOpen(false), [])

  function newChat() {
    setHistoryOpen(false)
    setTopicId(null) // 첫 화면을 고르기 전 상태로 되돌린다.
    if (activeRoomId) {
      navigate('/chat')
      return
    }
    setMessages([])
    setMessagesCursor(null)
    setConversationBlock(null)
    lastQuestion.current = ''
  }

  function dismissLegalNotice() {
    setShowLegalNotice(false)
    try {
      window.sessionStorage.setItem(LEGAL_NOTICE_DISMISSED_KEY, 'true')
    } catch {
      // 저장소를 사용할 수 없는 환경에서도 현재 화면에서는 고지를 닫는다.
    }
  }

  // 대화를 고르면 드로어만 닫는다. 활성 대화의 기준은 URL 이므로 채팅 영역은 그 자리에서
  // 내용만 바뀐다(화면 이동·리마운트 없음).
  const openRoom = useCallback(
    (roomId: string) => {
      setHistoryOpen(false)
      if (roomId === activeRoomIdRef.current) return
      void navigate(`/chat/${encodeURIComponent(roomId)}`)
    },
    [navigate],
  )

  /**
   * 추천 주제 선택 — 채팅은 만들지 않고 첫 화면(Hero)의 제목·설명·추천 질문만 바꾼다.
   * 실제 채팅은 추천 질문을 누르거나 직접 입력해 보낼 때 생긴다.
   */
  const selectTopic = useCallback(
    (id: string) => {
      setHistoryOpen(false)
      if (activeRoomIdRef.current) {
        // 대화를 보고 있으면 바꿀 Hero 가 화면에 없다 — 새 대화 화면으로 나가 그 주제를 보여준다.
        setTopicId(id)
        void navigate('/chat')
        return
      }
      setTopicId((prev) => (prev === id ? null : id)) // 같은 주제를 다시 누르면 기본 화면
    },
    [navigate],
  )

  const handleRename = useCallback((room: ChatRoom) => {
    setRenameTarget(room)
  }, [])

  const handleDelete = useCallback((room: ChatRoom) => {
    setDeleteTarget(room)
  }, [])

  // 성공 토스트는 서버 응답의 message 를 client.ts 가 띄운다 — 여기서 또 띄우면 두 번 뜬다.

  // 제목 수정은 last_chat_at 을 바꾸지 않으므로 현재 자리의 항목만 교체한다.
  const handleRenamed = useCallback((updated: ChatRoom) => {
    setRooms((prev) => prev.map((room) => (room.id === updated.id ? updated : room)))
    setRenameTarget(null)
  }, [])

  const handleDeleted = useCallback(
    (roomId: string) => {
      setRooms((prev) => prev.filter((room) => room.id !== roomId))
      setDeleteTarget(null)
      // 보고 있던 대화를 지웠으면 URL 이 활성 대화의 단일 기준이므로 새 대화 화면으로 간다.
      if (activeRoomIdRef.current === roomId) void navigate('/chat')
    },
    [navigate],
  )

  const closeRenameModal = useCallback(() => setRenameTarget(null), [])
  const closeDeleteModal = useCallback(() => setDeleteTarget(null), [])

  // 위로 스크롤 시 과거 메시지 prepend (스크롤 위치 보정은 MessageList 가 처리).
  const loadOlder = useCallback(() => {
    if (!activeRoomId || !messagesCursor || loadingOlder) return
    setLoadingOlder(true)
    const roomId = activeRoomId
    listMessages(roomId, messagesCursor)
      .then((page) => {
        if (activeRoomIdRef.current !== roomId) return
        setMessages((prev) => [...page.items.map(toMessage), ...prev])
        setMessagesCursor(page.next_cursor)
      })
      // 실패는 공통 오류 모달이 알린다. 이미 보고 있는 메시지는 그대로 두고,
      // 커서도 유지해 다시 위로 스크롤하면 같은 페이지를 재시도한다.
      .catch(() => {})
      .finally(() => setLoadingOlder(false))
  }, [activeRoomId, messagesCursor, loadingOlder])

  const onStreamingDone = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)))
  }, [])

  async function submitQuestion(text: string, regenerate = false) {
    const q = text.trim()
    // 어느 방이든 생성 중이면 보내지 않는다(방을 옮겨도 마찬가지). 막힌 이유는 입력창이 안내한다.
    if (!q || generatingRef.current) return
    generatingRef.current = true

    // 직접 전송(재생성 포함)은 과거를 읽던 중이어도 최신 메시지 추적을 강제로 시작한다.
    setFollowLatestRequest((request) => request + 1)

    const history: ChatTurn[] = messages
      .filter((m) => !m.error)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }))

    if (!regenerate) {
      setMessages((m) => [...m, { id: newId(), role: 'user', content: q }])
    }
    lastQuestion.current = q
    setInput('')
    // 이 요청이 어느 방의 것인지 들고 다닌다 — 방을 옮겨도 '작성중' 은 자기 방에만 남는다.
    // 새 대화는 방을 만든 뒤 URL 전환까지 한 왕복(질문 저장)이 더 걸려서 그 사이 두 슬롯을
    // 함께 켜 둔다. 그래서 정리는 하나가 아니라 켜 둔 것 전부를 대상으로 한다.
    const pendingKeys = new Set<string>()
    const markPending = (key: string) => {
      pendingKeys.add(key)
      setPending(key, true)
    }
    markPending(roomKey(activeRoomId))

    // regenerate 면 끝에 붙어있던 에러 버블을 제거하고 다시 시도한다.
    const dropTrailingError = (list: Message[]) =>
      regenerate && list[list.length - 1]?.error ? list.slice(0, -1) : list

    let roomId = activeRoomId
    try {
      if (persistent && !roomId) {
        const room = await createRoom(q.slice(0, 40)) // 첫 질문을 방 제목으로
        roomId = room.id
        // 실제 방 슬롯을 함께 켠다. 새 대화 슬롯은 URL 전환까지 그대로 둔다 — 여기서 끄면
        // 아래 질문 저장(한 왕복) 동안 '지금 보는 방'(아직 새 대화다)이 대기 목록에서 빠져
        // 인디케이터가 사라지고 입력창 안내가 '다른 대화에서...' 로 바뀌며 깜빡인다.
        markPending(roomId)
        setRooms((prev) => [room, ...prev.filter((item) => item.id !== room.id)])
      }
      if (persistent && roomId && !regenerate) await addMessage(roomId, 'USER', q)
      // 방을 만드는 사이 사용자가 다른 대화를 열었으면 새 방으로 끌고 오지 않는다.
      if (persistent && roomId && activeRoomId === null && activeRoomIdRef.current === null) {
        createdRoomIdRef.current = roomId
        activeRoomIdRef.current = roomId
        navigate(`/chat/${encodeURIComponent(roomId)}`)
      }
      // 방을 새로 만든 경우에만 새 대화 슬롯을 뒤늦게 끈다. 이제 URL 이 새 방을 가리키거나
      // (혹은 사용자가 다른 방으로 옮겨) 새 대화 화면은 이 요청과 무관하다 — 그대로 남기면
      // '+ 새 대화' 로 나갔을 때 빈 화면에 인디케이터가 샌다.
      if (persistent && roomId && activeRoomId === null) {
        pendingKeys.delete(NEW_CHAT_KEY)
        setPending(NEW_CHAT_KEY, false)
      }

      const res = await sendChat(q, history)
      if (!persistent || activeRoomIdRef.current === roomId) {
        setMessages((m) => [
          ...dropTrailingError(m),
          { id: newId(), role: 'assistant', content: res.answer, streaming: true },
        ])
      }

      if (persistent && roomId) {
        await addMessage(roomId, 'ASSISTANT', res.answer, res.response_time_ms)
        touchRoom(roomId)
      }
    } catch (e) {
      // 401 이면 세션이 끊긴 것이다 — client.ts 가 로그아웃시키고 로그인 화면으로 넘긴다.
      // 답변 생성 실패로 보이게 하면 사용자가 재시도만 반복하게 된다.
      if (e instanceof ApiError && e.code === 401) return
      const content =
        e instanceof ApiError
          ? '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : '답변을 생성하지 못했습니다. 네트워크 연결을 확인해 주세요.'
      if (!persistent || activeRoomIdRef.current === roomId) {
        setMessages((m) => [
          ...dropTrailingError(m),
          { id: newId(), role: 'assistant', content, error: true },
        ])
      }
    } finally {
      generatingRef.current = false
      pendingKeys.forEach((key) => setPending(key, false))
      pendingKeys.clear()
    }
  }

  // memo 된 MessageItem 에 내려가는 콜백이라 identity 는 고정하고, 대신 최신 렌더의
  // submitQuestion 을 ref 로 붙잡는다. 그래야 재생성 시점의 messages(맥락)·sending 을 본다
  // (중복 전송 방지는 submitQuestion 첫 줄의 sending 가드가 담당).
  const submitRef = useRef(submitQuestion)
  submitRef.current = submitQuestion

  const regenerate = useCallback(() => {
    void submitRef.current(lastQuestion.current, true)
  }, [])

  /**
   * 목록 오류에서 "다시 시도".
   *
   * 이미 불러온 목록이 있으면 오류만 지워 무한스크롤을 재개한다 — 1페이지부터 다시 받으면
   * 스크롤로 쌓아둔 뒷 페이지가 통째로 사라지기 때문이다.
   */
  const retryRooms = useCallback(() => {
    if (rooms.length > 0) setRoomsError(null)
    else retryLoadRooms()
  }, [rooms.length, retryLoadRooms])

  const groups = useMemo(() => groupRoomsByDate(rooms), [rooms])

  if (initializing) {
    return (
      <div className={styles.page}>
        <div className={styles.initialLoading} role="status" aria-live="polite">
          <span className={styles.initialSpinner} aria-hidden="true" />
          <span>대화를 불러오는 중입니다.</span>
        </div>
      </div>
    )
  }

  const showEmpty =
    activeRoomId === null && messages.length === 0 && !openingRoom && !sending

  // 데스크탑 사이드바와 모바일 드로어가 **같은 목록 컴포넌트**를 쓴다 — 담는 그릇만 다르다.
  const historyPanel = (
    <ChatHistoryPanel
      variant={isMobile ? 'drawer' : 'sidebar'}
      persistent={persistent}
      groups={groups}
      isEmpty={rooms.length === 0}
      roomsError={roomsError}
      hasMoreRooms={roomsCursor !== null}
      activeRoomId={activeRoomId}
      pendingRooms={pendingRooms}
      scrollRef={roomsScrollRef}
      sentinelRef={roomsSentinel}
      onNewChat={newChat}
      onOpenRoom={openRoom}
      onRenameRoom={handleRename}
      onDeleteRoom={handleDelete}
      onRetryRooms={retryRooms}
      footer={
        <ChatSuggestTopics
          topicId={topicId}
          open={suggestOpen}
          onToggle={() => setSuggestOpen((open) => !open)}
          onSelect={selectTopic}
        />
      }
    />
  )

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {/* ── 대화 기록: 넓으면 사이드바, 좁으면 FAB → 드로어 ── */}
        {isMobile ? (
          <>
            <ChatMobileActions
              hidden={actionsHidden}
              onOpenHistory={() => setHistoryOpen(true)}
              onNewChat={newChat}
            />
            <Drawer open={historyOpen} onClose={closeHistory} title="대화기록">
              {historyPanel}
            </Drawer>
          </>
        ) : (
          <aside className={styles.sidebar}>{historyPanel}</aside>
        )}

        {/* ── 채팅 영역 ── */}
        <section className={styles.chat}>
          {showLegalNotice && !showEmpty && !conversationBlock && (
            <div className={styles.notice} role="note">
              <Info className={styles.noticeIcon} />
              <span className={styles.noticeText}>
                법적 고지: 본 서비스는 공공 기록을 바탕으로 한 자동 분석 정보를 제공하며, 정식 법률
                대리나 자문을 대신하지 않습니다.
              </span>
              <button
                type="button"
                className={styles.noticeClose}
                aria-label="법적 고지 닫기"
                onClick={dismissLegalNotice}
              >
                <Close className={styles.noticeCloseIcon} />
              </button>
            </div>
          )}

          {conversationBlock?.reason === 'unavailable' ? (
            // API 실패가 아니라 로그인·저장소 설정 문제다 — 다시 시도해도 결과가 같다.
            <div className={styles.conversationError}>
              <ErrorState variant="plain" message="로그인 상태와 채팅 저장소 설정을 확인해 주세요." />
            </div>
          ) : conversationBlock ? (
            <div className={styles.conversationError}>
              <ErrorState
                variant="plain"
                message={
                  conversationBlock.error instanceof ApiError
                    ? conversationBlock.error.message
                    : CONVERSATION_NETWORK_ERROR
                }
                onRetry={isRetryable(conversationBlock.error) ? retryLoadMessages : undefined}
                // 재시도가 없는 실패(삭제됐거나 내 대화가 아닌 방)면 입력창도 숨겨져 있어
                // 이 버튼이 없으면 오른쪽 영역에서 빠져나갈 길이 없다.
                action={{ label: '새 대화 시작', onClick: newChat }}
              />
            </div>
          ) : showEmpty ? (
            <EmptyState
              topic={topicById(topicId)}
              disabled={busyElsewhere}
              onExample={(q) => void submitQuestion(q)}
              onScroll={isMobile ? onThreadScroll : undefined}
            />
          ) : (
            <MessageList
              key={activeRoomId ?? 'new'}
              messages={messages}
              sending={sending}
              isLoading={openingRoom}
              isLoadingOlder={loadingOlder}
              hasMoreOlder={messagesCursor !== null}
              followLatestRequest={followLatestRequest}
              onLoadOlder={loadOlder}
              onStreamingDone={onStreamingDone}
              onRegenerate={regenerate}
              onScroll={isMobile ? onThreadScroll : undefined}
            />
          )}

          {!conversationBlock && (
            <ChatComposer
              value={input}
              onChange={setInput}
              onSubmit={() => void submitQuestion(input)}
              disabled={sending || openingRoom || busyElsewhere}
              notice={busyElsewhere ? BUSY_ELSEWHERE_NOTICE : undefined}
              maxLength={MAX_LEN}
            />
          )}
        </section>
      </div>

      {renameTarget && (
        <RenameRoomModal
          room={renameTarget}
          onClose={closeRenameModal}
          onSaved={handleRenamed}
        />
      )}
      {deleteTarget && (
        <DeleteRoomModal
          room={deleteTarget}
          onClose={closeDeleteModal}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}
