import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { getAnalysis, startAnalysis } from '../../api/analyses'
import { sendChat, type ChatTurn } from '../../api/chat'
import {
  addMessage,
  attachDocument,
  createRoom,
  detachDocument,
  listMessages,
  listRooms,
  updateMessage,
  type ChatMessageRow,
  type ChatRoom,
} from '../../api/chatHistory'
import { isRetryable } from '../../api/apiErrorHandler'
import { isTerminal } from '../../types/analysis'
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
import type { AttachmentKind, Message, PendingFile, RetryContext, RoomAttachment } from './types'
import { showToast } from '../../components/Toast/toastStore'
import {
  MAX_TOTAL_FILES,
  describeRejections,
  fileKey,
  isPdf,
  mergeFiles,
} from '../../utils/uploadFiles'
import styles from './Chat.module.scss'

const MAX_LEN = 2000
const HISTORY_TURNS = 10 // RAG 에 함께 보내는 최근 맥락 수
/** 첨부 계약서 분석 폴링 간격·상한. 분석은 OCR + LLM 이라 수 분까지 걸린다. */
const ATTACH_POLL_MS = 2000
const ATTACH_TIMEOUT_MS = 10 * 60 * 1000
const LEGAL_NOTICE_DISMISSED_KEY = 'homeshield:legal-notice-dismissed'

/** 아직 방이 없는 새 대화의 대기 키. 방 id 는 빈 문자열이 될 수 없어 충돌하지 않는다. */
const NEW_CHAT_KEY = ''
const roomKey = (roomId: string | null) => roomId ?? NEW_CHAT_KEY

/** 입력창 플레이스홀더 자리에 들어가므로 한 줄로 짧게 — 자세한 위치는 사이드바 점이 알린다. */
const BUSY_ELSEWHERE_NOTICE = '다른 대화에서 답변을 생성 중입니다...'

let _id = 0
const newId = () => `m${Date.now()}-${_id++}`

const toMessage = (r: ChatMessageRow): Message => ({
  id: r.id,
  // 기록에서 되살아난 메시지는 로컬 id 없이 서버 id 로 산다 — 재시도가 이 행을 갈아끼울 수 있게
  // serverId 에도 같은 값을 둔다.
  serverId: r.id,
  role: r.role === 'ASSISTANT' ? 'assistant' : 'user',
  content: r.content,
  // 서버에는 이름·종류만 있다. previewUrl 은 이번 세션에 고른 파일에만 있으므로
  // 기록에서 되살아난 메시지는 썸네일 대신 아이콘으로 그려진다.
  attachments: r.attachments?.length ? r.attachments.map((a) => ({ ...a })) : undefined,
})

/** 첨부만 두고 보냈을 때 대신 보내는 질문. 빈 문자열은 서버(min_length=1)가 막는다. */
const ATTACHMENT_ONLY_QUESTION = '첨부한 계약서를 분석해 주세요.'
/** 첨부를 읽는 동안 잠깐 보여주는 자리표시. DB 에 저장하지 않는다. */
const READING_NOTICE = '계약서를 읽고 있습니다'
/** 첨부 실패에 사유가 없을 때만 쓰는 문구 — 보통은 서버·폴링이 만든 구체적인 사유를 그대로 쓴다. */
const ATTACH_FAILED_REASON = '첨부한 파일을 읽지 못했습니다.'

const attachmentKind = (file: File): AttachmentKind => (isPdf(file) ? 'pdf' : 'image')

/**
 * 방에 붙은 계약서의 파일명들. 예전 서버는 analysis_file_names 를 내려주지 않으므로
 * 단일 필드로 물러난다 — 배포 순서 때문에 배지가 빈 채로 보이지 않게.
 */
const roomFileNames = (room: ChatRoom): string[] =>
  room.analysis_file_names?.length
    ? room.analysis_file_names
    : room.analysis_file_name
      ? [room.analysis_file_name]
      : ['첨부한 계약서']

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

/**
 * 아직 보내지 않은 첨부와 **그것을 고른 대화**. 파일 목록만 들고 있으면 A 에서 고른 파일이
 * B 로 따라가 그대로 전송된다 — 어느 방의 것인지가 목록만큼 중요한 정보다.
 */
interface PendingAttachment {
  roomId: string | null
  files: PendingFile[]
}

/** 다른 방의 첨부를 볼 때 돌려주는 빈 목록. 매번 새 배열을 만들면 하위 렌더가 헛돈다. */
const NO_PENDING_FILES: PendingFile[] = []

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
  const {
    hidden: actionsHidden,
    onScroll: onThreadScroll,
    reveal: revealActions,
  } = useHideOnScrollDown()

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
  // 아직 보내지 않은 첨부파일. 고르는 것만으로는 업로드하지 않고, 전송할 때 함께 올라간다 —
  // 그래야 ✕ 로 뺄 수 있는 구간이 생긴다(예전엔 고르는 즉시 OCR 이 돌아 취소할 수 없었다).
  // 어느 방에서 고른 것인지 함께 들고 있다가, 대화를 옮기면 폐기한다.
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment>(() => ({
    roomId: activeRoomId,
    files: [],
  }))
  // 이 대화가 지금 참고 중인 계약서(방 단위). 새로 첨부하면 통째로 교체된다.
  // 본문은 프론트가 들고 있지 않다 — 서버가 방에 붙은 분석에서 읽는다.
  const [roomAttachment, setRoomAttachment] = useState<RoomAttachment | null>(null)
  // 다시 시도할 수 있는 **실패한 턴 하나**(가장 최근 것). 질문·파일·대상 말풍선이 한 덩어리다 —
  // 따로 들고 있으면 "A 첨부 실패 → 질문 B 전송 → 실패 말풍선의 재시도" 에서 계약서 A 와 질문 B 가
  // 함께 나간다. 새 질문·방 이동·성공은 이 덩어리째 버려서 원본 File 참조까지 함께 놓아준다.
  const [retryContext, setRetryContext] = useState<RetryContext | null>(null)

  const activeRoomIdRef = useRef<string | null>(activeRoomId)
  const createdRoomIdRef = useRef<string | null>(null)
  // 업로드가 진행 중인 **방들**. 그 방의 배지만 방 목록 동기화에서 지켜 준다 — 전역 플래그였을
  // 때는 A 가 업로드하는 동안 B 로 옮기면 B 의 배지 동기화까지 통째로 걸러져, 다른 방의
  // '참고 중' 표시가 낡은 채로 남았다.
  const uploadingRoomsRef = useRef<Set<string>>(new Set())
  // 언마운트·제거 때 revoke 하려고 만들어 둔 objectURL 을 모아 둔다(놔두면 메모리에 남는다).
  const objectUrlsRef = useRef<Set<string>>(new Set())
  // 목록 무한스크롤의 스크롤 컨테이너. 사이드바·드로어 중 지금 마운트된 쪽이 채운다.
  const roomsScrollRef = useRef<HTMLDivElement>(null)
  const roomsSentinel = useRef<HTMLDivElement>(null)
  // pendingRooms 는 리렌더 후에야 반영된다 — 연타로 두 요청이 새는 걸 막으려면 즉시 잠가야 한다.
  const generatingRef = useRef(false)
  activeRoomIdRef.current = activeRoomId

  // 지금 보고 있는 방에서 고른 첨부만 화면에 있는 셈이다. 폐기 effect 가 돌기 전(같은 커밋)
  // 에도 B 의 입력창에 A 의 첨부가 비치지 않게, 렌더 단계에서 방을 대조한다.
  const pendingFiles =
    pendingAttachment.roomId === activeRoomId ? pendingAttachment.files : NO_PENDING_FILES

  // 재시도 버튼을 달아 줄 말풍선. 폐기 effect 가 돌기 전(같은 커밋)에도 다른 방의 재시도가
  // 이 화면에 비치지 않게, 여기서도 방을 대조한다.
  const retryMessageId =
    retryContext && retryContext.roomId === activeRoomId ? retryContext.localMessageId : null
  // memo 된 콜백이 최신 재시도 대상을 보되 identity 는 고정되게 붙잡아 둔다.
  const retryRef = useRef<RetryContext | null>(retryContext)
  retryRef.current = retryContext

  /**
   * 썸네일 objectURL 반납. **state updater 안에서 부르지 않는다** — updater 는 StrictMode 에서
   * 두 번 실행될 수 있어 부수효과를 넣으면 같은 URL 을 두 번 반납한다.
   * 이미 반납한 URL 은 Set 에서 빠져 있으므로 두 번 불러도 한 번만 처리된다.
   */
  const revokePreview = useCallback((url: string | undefined) => {
    if (!url || !objectUrlsRef.current.delete(url)) return
    URL.revokeObjectURL(url)
  }, [])

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
    setRetryContext(null) // 화면을 비웠으니 재시도할 말풍선도 없다.
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

  // 방을 열거나 목록이 갱신되면 '참고 중' 배지를 방 정보로 복원한다 — 새로고침·대화 재진입
  // 에서도 "이 대화는 계약서를 보고 있다"가 보여야 한다.
  // **지금 보는 방**의 업로드가 진행 중일 때만 덮지 않는다(목록에 아직 반영 전이라 배지가
  // 깜빡였다 사라진다). 다른 방이 업로드 중이어도 이 방의 배지는 제 정보로 채운다.
  useEffect(() => {
    if (!activeRoomId) {
      setRoomAttachment(null)
      return
    }
    if (uploadingRoomsRef.current.has(activeRoomId)) return
    const room = rooms.find((r) => r.id === activeRoomId)
    // 목록에 아직 없으면(깊은 링크로 들어와 첫 페이지 밖) 그대로 둔다. 배지는 표시일 뿐이고,
    // 답변에 계약서를 넣을지는 서버가 방 정보를 보고 정한다.
    if (!room) return
    setRoomAttachment(room.analysis_job_id ? { fileNames: roomFileNames(room) } : null)
  }, [activeRoomId, rooms])

  // 대화를 옮기면 **아직 보내지 않은** 첨부는 버린다 — A 에서 고른 파일이 B 에 보이거나 B 로
  // 전송되면 안 된다. 화면 어디에서도 쓰지 않게 된 썸네일 URL 은 그 자리에서 반납한다
  // (언마운트까지 들고 있으면 원본 File 이 통째로 메모리에 남는다).
  useEffect(() => {
    if (pendingAttachment.roomId === activeRoomId) return
    const dropped = pendingAttachment.files
    setPendingAttachment({ roomId: activeRoomId, files: [] })
    dropped.forEach((p) => revokePreview(p.previewUrl))
  }, [activeRoomId, pendingAttachment, revokePreview])

  // 대화를 옮기면 그 방의 재시도 권한도 함께 버린다. 그 실패 말풍선은 이제 화면에 없고, 남겨
  // 두면 A 에서 실패한 파일이 B 의 재시도에 실려 나간다 — 붙잡고 있던 원본 File 도 여기서
  // 놓아준다(썸네일 URL 은 아래 정리 effect 가 화면 기준으로 반납한다).
  useEffect(() => {
    setRetryContext((prev) => (prev && prev.roomId !== activeRoomId ? null : prev))
  }, [activeRoomId])

  // 화면 어디에서도 더 이상 참조하지 않는 objectURL 을 반납한다. 방을 옮겨 메시지가 통째로
  // 바뀌거나, 재시도로 실패 말풍선이 걷히면 그 썸네일은 즉시 쓸모가 없어진다 — 재시도용으로
  // File 을 들고 있더라도 화면에 없는 preview URL 까지 살려 둘 이유는 없다.
  useEffect(() => {
    const inUse = new Set<string>()
    for (const m of messages) {
      for (const a of m.attachments ?? []) if (a.previewUrl) inUse.add(a.previewUrl)
    }
    for (const p of pendingFiles) if (p.previewUrl) inUse.add(p.previewUrl)
    for (const url of [...objectUrlsRef.current]) {
      if (!inUse.has(url)) revokePreview(url)
    }
  }, [messages, pendingFiles, revokePreview])

  // 화면을 떠날 때 남은 썸네일 URL 을 정리한다.
  useEffect(() => {
    const urls = objectUrlsRef.current
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url))
      urls.clear()
    }
  }, [])

  /** 분석이 끝날 때까지 폴링한다. 실패·취소·시간초과는 사용자에게 보일 문구로 던진다. */
  async function waitForAnalysis(jobId: string): Promise<void> {
    const deadline = Date.now() + ATTACH_TIMEOUT_MS
    for (;;) {
      // 폴링이라 실패마다 모달이 뜨면 화면을 덮는다 — 칩이 대신 알린다.
      const job = await getAnalysis(jobId, true)
      if (job.status === 'SUCCEEDED') return
      if (isTerminal(job.status)) {
        throw new Error(job.error?.message ?? '계약서를 분석하지 못했습니다.')
      }
      if (Date.now() > deadline) {
        throw new Error('분석이 오래 걸립니다. 잠시 후 다시 첨부해 주세요.')
      }
      await new Promise((resolve) => setTimeout(resolve, ATTACH_POLL_MS))
    }
  }

  /**
   * 고른 파일을 프리뷰에 담는다. **여기서는 아무것도 업로드하지 않는다** — 전송할 때
   * 한 건의 분석으로 함께 올라간다. 그래서 보내기 전까지는 ✕ 로 자유롭게 뺄 수 있다.
   *
   * objectURL 생성과 토스트는 **state updater 밖**에서 한다. updater 안에 두면 StrictMode 가 그
   * 함수를 두 번 실행할 때 URL 이 두 개 생기고(하나는 영영 반납되지 않는다) 거부 토스트도
   * 두 번 뜬다.
   */
  function handlePickFiles(files: File[]) {
    if (!persistent) {
      showToast('로그인하면 계약서를 첨부할 수 있습니다', 'info')
      return
    }
    const prev = pendingFiles
    const { files: merged, rejected } = mergeFiles(
      prev.map((p) => p.file),
      files,
      MAX_TOTAL_FILES - prev.length,
    )
    // 거부 사유(형식·용량·개수·중복)는 공통 유틸이 문구까지 만들어 준다.
    describeRejections(rejected, '첨부').forEach((n) => showToast(n.message, n.type))

    const next = merged.map((file) => {
      const key = fileKey(file)
      const existing = prev.find((p) => p.key === key)
      if (existing) return existing
      const kind = attachmentKind(file)
      // 이미지는 보내기 전에도 무엇을 골랐는지 보여야 한다. URL 은 제거·대화 전환·언마운트 때
      // 반납한다. 썸네일을 못 만들어도 파일까지 잃지는 않는다 — 아이콘으로 떨어질 뿐이다.
      let previewUrl: string | undefined
      if (kind === 'image') {
        try {
          previewUrl = URL.createObjectURL(file)
          objectUrlsRef.current.add(previewUrl)
        } catch {
          previewUrl = undefined
        }
      }
      return { key, file, kind, previewUrl }
    })
    // 고른 파일은 **지금 보고 있는 대화**의 것이다.
    setPendingAttachment({ roomId: activeRoomId, files: next })
  }

  /** 아직 보내지 않은 첨부 하나를 뺀다. 서버에는 올라간 적이 없으므로 로컬만 지우면 된다. */
  function handleRemovePendingFile(key: string) {
    const removed = pendingFiles.find((p) => p.key === key)
    setPendingAttachment({
      roomId: activeRoomId,
      files: pendingFiles.filter((p) => p.key !== key),
    })
    // 화면에서 뺐으면 썸네일도 그 자리에서 반납한다(updater 밖이라 한 번만 실행된다).
    revokePreview(removed?.previewUrl)
  }

  /** 방이 참고 중인 계약서를 뗀다. 분석과 위험 보고서는 그대로 남는다. */
  async function handleDetachRoomDocument() {
    const roomId = activeRoomIdRef.current
    setRoomAttachment(null)
    if (!roomId) return
    try {
      const updated = await detachDocument(roomId)
      setRooms((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
    } catch {
      // 실패하면 방 목록이 다음 동기화에서 배지를 되살린다 — 공통 모달이 이미 사유를 알렸다.
    }
  }

  /**
   * 첨부파일을 올려 이 방에 연결한다. 기존 분석 파이프라인(OCR·마스킹·개인정보 검증)을
   * 그대로 쓰고, 완료된 분석을 방에 붙여 이후 질문마다 서버가 계약서를 함께 읽게 한다.
   *
   * 여러 파일은 **한 건의 분석**으로 올린다 — 방이 참고하는 계약서는 한 세트이고, 나눠
   * 올리면 회원당 진행 중 분석 1건 제약에 스스로 걸린다.
   */
  async function uploadAndAttach(roomId: string, files: File[]): Promise<void> {
    // 올리는 동안에는 이 방의 배지만 목록 동기화에서 지켜 준다(다른 방 배지는 계속 갱신된다).
    uploadingRoomsRef.current.add(roomId)
    try {
      // 채팅은 대화 안에서 진행 상태와 결과를 그대로 보여준다 — 알림까지 쌓으면 중복이다.
      const job = await startAnalysis(files, undefined, { silent: true, notify: false })
      await waitForAnalysis(job.id)
      const updated = await attachDocument(roomId, job.id)
      setRooms((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      if (activeRoomIdRef.current === roomId) {
        setRoomAttachment({ fileNames: roomFileNames(updated) })
      }
    } finally {
      uploadingRoomsRef.current.delete(roomId)
    }
  }

  /**
   * 한 턴 전송. `retry` 가 있으면 **그 실패한 턴을** 다시 보낸다 — 질문·파일·갈아끼울 말풍선이
   * 전부 그 덩어리에서 나오므로, 그 사이 다른 질문을 보냈어도 섞이지 않는다.
   */
  async function submitQuestion(text: string, retry: RetryContext | null = null) {
    // 재시도는 **아직 못 붙인** 첨부만 다시 올린다. 방에 이미 붙은 계약서는 서버가 들고 있어
    // 다시 올릴 이유가 없지만(그때는 files 가 비어 있다), 첨부 단계에서 실패한 파일은 여기서
    // 되살리지 않으면 계약서 없이 되묻게 되고 사용자는 그 사실을 알 수 없다.
    const outgoing = retry ? retry.files : pendingFiles
    // 사용자가 실제로 쓴 글이 있었는지. 있으면 첨부가 실패해도 계약서 없이라도 답한다.
    const typed = retry ? retry.typed : text.trim().length > 0
    // 첨부만 두고 보내는 것도 뜻이 분명한 요청이다. 무엇을 물었는지는 기본 문구가 채운다.
    const q = retry
      ? retry.question
      : text.trim() || (outgoing.length > 0 ? ATTACHMENT_ONLY_QUESTION : '')
    // 어느 방이든 생성 중이면 보내지 않는다(방을 옮겨도 마찬가지). 막힌 이유는 입력창이 안내한다.
    if (!q || generatingRef.current) return
    generatingRef.current = true
    // 이 전송으로 이전 실패 턴의 재시도 권한은 사라진다. 새 질문이면 남은 경고 문구에서 버튼만
    // 걷히고(문구는 그 턴의 기록이라 남긴다), 재시도면 자기 자신을 대체한다. 어느 쪽이든 여기서
    // 붙잡고 있던 원본 File 참조를 놓아준다 — 이게 옛 파일이 새 질문에 실리던 통로였다.
    setRetryContext(null)
    // 실패하면 다시 올릴 파일. 첨부에 성공하면 서버가 계약서를 들고 있으므로 비운다.
    let retryFiles = outgoing

    // 직접 전송(재시도 포함)은 과거를 읽던 중이어도 최신 메시지 추적을 강제로 시작한다.
    setFollowLatestRequest((request) => request + 1)

    // 재시도면 그 턴의 실패 말풍선을 걷어내고 다시 시도한다(에러 버블, 그리고 첨부를 못 읽은 채
    // 답한 말풍선). 남겨두면 같은 질문의 답이 둘로 쌓이고 어느 쪽이 계약서를 본 답인지 알 수 없다.
    // **id 로** 지운다 — '마지막 말풍선' 을 지우던 예전 방식은 무엇을 지우는지 클릭한 버튼과
    // 무관했다.
    const dropRetryTarget = (list: Message[]) =>
      retry ? list.filter((m) => m.id !== retry.localMessageId) : list

    // 걷어낼 말풍선이 DB 에도 저장돼 있으면(첨부 실패 답변) 새로 쌓지 말고 그 행을 갈아끼운다.
    // 안 그러면 새로고침했을 때 실패 답변과 재시도 답변이 나란히 남는다.
    const replacingMessageId = retry?.serverMessageId ?? null

    // 맥락도 걷어낸 뒤 기준이다 — 계약서를 못 읽고 답한 말풍선을 그대로 보내면, 모델이
    // "앞에서 이미 설명한 내용은 반복하지 마라" 규칙을 그 답에 적용해 같은 답을 되풀이한다.
    const history: ChatTurn[] = dropRetryTarget(messages)
      .filter((m) => !m.error && !m.pending)
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.content }))

    // 보낸 첨부는 이 메시지의 기록으로 남는다(서버에는 이름·종류만, 화면에는 썸네일까지).
    const sentAttachments = outgoing.map((p) => ({
      name: p.file.name,
      kind: p.kind,
      previewUrl: p.previewUrl,
    }))
    // 진행 버블을 나중에 지우려면 id 가 필요하다.
    const noticeId = newId()
    // 계약서를 읽는 동안 빈 화면을 두지 않는다. 답변이 오면 이 자리가 교체된다.
    const notice: Message[] =
      outgoing.length > 0
        ? [{ id: noticeId, role: 'assistant', content: READING_NOTICE, pending: true }]
        : []

    // 진행 버블("계약서를 읽고 있습니다")은 결과가 나오면 자리를 내준다.
    const dropPendingNotice = (list: Message[]) => list.filter((m) => m.id !== noticeId)

    if (!retry) {
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: 'user',
          content: q,
          attachments: sentAttachments.length > 0 ? sentAttachments : undefined,
        },
        ...notice,
      ])
    } else if (notice.length > 0) {
      // 재시도도 계약서를 다시 읽는다. 실패 말풍선을 지금 걷어내야 그 자리에 진행 상태가 보인다.
      setMessages((m) => [...dropRetryTarget(m), ...notice])
    }
    setInput('')
    // 프리뷰는 즉시 비운다 — 말풍선으로 옮겨 갔으므로 입력창에 남으면 두 번 보인다.
    // objectURL 은 말풍선이 계속 쓰므로 여기서 revoke 하지 않는다(말풍선이 화면에서 사라지면
    // 위의 정리 effect 가 그때 반납한다).
    // 재시도는 자기 파일을 따로 들고 있다 — 그 사이 사용자가 다음 질문용으로 고른 첨부까지
    // 대신 비우면 안 된다.
    if (!retry && outgoing.length > 0) setPendingAttachment({ roomId: activeRoomId, files: [] })
    // 이 요청이 어느 방의 것인지 들고 다닌다 — 방을 옮겨도 '작성중' 은 자기 방에만 남는다.
    // 새 대화는 방을 만든 뒤 URL 전환까지 한 왕복(질문 저장)이 더 걸려서 그 사이 두 슬롯을
    // 함께 켜 둔다. 그래서 정리는 하나가 아니라 켜 둔 것 전부를 대상으로 한다.
    const pendingKeys = new Set<string>()
    const markPending = (key: string) => {
      pendingKeys.add(key)
      setPending(key, true)
    }
    markPending(roomKey(activeRoomId))

    // 아래 catch 가 "무엇이 실패했는지" 로 문구를 고른다. 첨부 실패는 대부분 여기서 흡수되므로
    // (질문은 그대로 나간다) outgoing 유무만 보고는 더 이상 첨부 탓인지 알 수 없다.
    let attachThrew = false
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
      if (persistent && roomId && !retry) {
        // 첨부는 이름·종류만 저장한다 — previewUrl 은 이 세션에서만 유효한 objectURL 이다.
        await addMessage(
          roomId,
          'USER',
          q,
          undefined,
          sentAttachments.map(({ name, kind }) => ({ name, kind })),
        )
      }
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

      // 첨부가 있으면 답변 전에 먼저 읽힌다(OCR·분석은 수 분까지 걸린다).
      //
      // 여기서 실패해도 **사용자가 쓴 글이 있으면 질문까지 버리지 않는다** — 계약서 없이 답할 수
      // 있는 질문이 대부분이고, 예전처럼 오류 말풍선만 남기면 사용자는 다시 타이핑해야 했다.
      // 대신 못 읽었다는 사실은 두 곳에서 알린다: 답변 위 경고 줄(사유 그대로)과, 서버 플래그로
      // 모델이 답변 첫 문장에 넣는 인정 문구(이쪽만 DB 에 남는다).
      let degradedReason: string | null = null
      if (outgoing.length > 0 && roomId) {
        try {
          await uploadAndAttach(
            roomId,
            outgoing.map((p) => p.file),
          )
          // 방에 붙었으니 더는 들고 있을 이유가 없다 — 이제 재시도는 계약서를 다시 올리지 않는다.
          retryFiles = []
        } catch (e) {
          attachThrew = true
          // 세션 만료는 첨부 문제가 아니다. 삼키면 로그아웃 흐름을 놓치고 답변만 계속 시도한다.
          if (e instanceof ApiError && e.code === 401) throw e
          // 첨부만 보낸 턴은 예전대로 오류 말풍선. 계약서 없이 "계약서를 분석해 주세요" 에
          // 답하면 아무것도 못 본 채 지어낸 답이 된다.
          if (!typed) throw e
          degradedReason = e instanceof Error && e.message ? e.message : ATTACH_FAILED_REASON
          // retryFiles 는 그대로 둔다 — 경고 줄의 '파일 다시 첨부' 가 이 파일을 다시 올린다.
        }
      }

      // roomId 를 함께 넘기면 서버가 그 방에 첨부된 계약서를 근거에 넣는다.
      const res = await sendChat(q, history, roomId, degradedReason !== null)
      // 저장이 끝난 뒤 이 말풍선에 서버 id 를 붙여야 하므로 id 를 미리 잡아 둔다.
      const answerId = newId()
      if (!persistent || activeRoomIdRef.current === roomId) {
        setMessages((m) => [
          ...dropPendingNotice(dropRetryTarget(m)),
          {
            id: answerId,
            role: 'assistant',
            content: res.answer,
            streaming: true,
            degradedNotice: degradedReason ?? undefined,
          },
        ])
        // 계약서를 못 읽고 답한 턴만 다시 시도할 수 있다. 대상은 방금 만든 이 말풍선이고,
        // 질문과 파일도 이 턴의 것으로 못 박는다 — 다음 질문이 들어오면 통째로 폐기된다.
        if (degradedReason !== null) {
          setRetryContext({
            roomId,
            question: q,
            typed,
            files: retryFiles,
            localMessageId: answerId,
            // 재시도가 또 계약서 없이 답했다면 갈아끼울 행은 여전히 방금 PUT 한 그 행이다.
            // (저장이 끝나면 아래에서 실제 id 로 확정한다.)
            serverMessageId: replacingMessageId,
          })
        }
      }

      if (persistent && roomId) {
        // 첨부 실패 답변을 교체하는 재시도면 **기존 행을 갈아끼운다.** 새로 저장하면 DB 에는
        // 실패 답변이 남아, 새로고침했을 때 답이 둘로 보인다(화면에서만 걷어낸 탓이었다).
        // created_at 은 서버가 건드리지 않으므로 대화 순서도 그대로다.
        const saved = replacingMessageId
          ? await updateMessage(roomId, replacingMessageId, res.answer, res.response_time_ms)
          : await addMessage(roomId, 'ASSISTANT', res.answer, res.response_time_ms)
        // 이 답변도 첨부를 못 읽은 채 나갔다면 다음 재시도가 같은 행을 교체할 수 있어야 한다.
        // (그 사이 새 질문이 들어와 재시도가 폐기됐으면 되살리지 않는다 — id 로 확인한다.)
        if (degradedReason !== null) {
          setMessages((m) => m.map((x) => (x.id === answerId ? { ...x, serverId: saved.id } : x)))
          setRetryContext((prev) =>
            prev?.localMessageId === answerId ? { ...prev, serverMessageId: saved.id } : prev,
          )
        }
        touchRoom(roomId)
      }
    } catch (e) {
      // 401 이면 세션이 끊긴 것이다 — client.ts 가 로그아웃시키고 로그인 화면으로 넘긴다.
      // 답변 생성 실패로 보이게 하면 사용자가 재시도만 반복하게 된다.
      if (e instanceof ApiError && e.code === 401) return
      // 여기까지 온 첨부 실패는 되살릴 글이 없는 경우(첨부만 보낸 턴)다. 사유가 구체적이므로
      // (형식·용량·개인정보 잔존·진행 중 분석 1건 제약) 서버·폴링이 만든 문구를 그대로 보여준다
      // — "답변 생성 실패" 로 뭉개면 사용자가 파일을 고칠 생각을 못 하고 재시도만 반복한다.
      const content =
        attachThrew && e instanceof Error && e.message
          ? e.message
          : e instanceof ApiError
            ? '답변을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'
            : '답변을 생성하지 못했습니다. 네트워크 연결을 확인해 주세요.'
      const errorId = newId()
      if (!persistent || activeRoomIdRef.current === roomId) {
        setMessages((m) => [
          ...dropPendingNotice(dropRetryTarget(m)),
          { id: errorId, role: 'assistant', content, error: true },
        ])
        // '다시 생성' 은 **실패했던 그 질문**을 다시 보낸다. 오류 버블 자체는 DB 에 저장된 적이
        // 없지만, 재시도가 실패한 경우라면 갈아끼우려던 degraded 행은 아직 그대로 있다 —
        // 그 대상까지 넘겨줘야 다음 성공이 새 행을 쌓지 않고 그 자리를 채운다.
        setRetryContext({
          roomId,
          question: q,
          typed,
          files: retryFiles,
          localMessageId: errorId,
          serverMessageId: replacingMessageId,
        })
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

  /**
   * 실패 말풍선의 '다시 생성'·'파일 다시 첨부'. **클릭한 말풍선**의 재시도만 받아들인다 —
   * 그 사이 새 질문을 보냈거나 방을 옮겨 재시도가 폐기됐으면 아무 일도 하지 않는다(버튼도
   * 이미 사라져 있다). 이 대조가 없으면 옛 파일이 최신 질문에 실려 나간다.
   */
  const regenerate = useCallback((messageId: string) => {
    const context = retryRef.current
    if (!context || context.localMessageId !== messageId) return
    if (context.roomId !== activeRoomIdRef.current) return
    void submitRef.current('', context)
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

  const showEmpty = activeRoomId === null && messages.length === 0 && !openingRoom && !sending

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
        {/* ── 대화 기록: 넓으면 사이드바, 좁으면 FAB(아래 .chatBody 안) → 드로어 ── */}
        {isMobile ? (
          <Drawer open={historyOpen} onClose={closeHistory} title="대화기록">
            {historyPanel}
          </Drawer>
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

          {/* 고지 바 '아래'에서 시작하는 본문 — 떠 있는 액션이 이 박스를 기준으로 뜬다.
              그래서 고지를 닫으면 본문이 올라오면서 버튼도 함께 따라 올라온다. */}
          <div className={styles.chatBody}>
            {isMobile && (
              <ChatMobileActions
                hidden={actionsHidden}
                onOpenHistory={() => setHistoryOpen(true)}
                onNewChat={newChat}
              />
            )}

            {conversationBlock?.reason === 'unavailable' ? (
              // API 실패가 아니라 로그인·저장소 설정 문제다 — 다시 시도해도 결과가 같다.
              <div className={styles.conversationError}>
                <ErrorState
                  variant="plain"
                  message="로그인 상태와 채팅 저장소 설정을 확인해 주세요."
                />
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
                retryMessageId={retryMessageId}
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
                pendingFiles={pendingFiles}
                onPickFiles={handlePickFiles}
                onRemovePendingFile={handleRemovePendingFile}
                roomAttachment={roomAttachment}
                onDetachRoomDocument={() => void handleDetachRoomDocument()}
              />
            )}
          </div>
        </section>
      </div>

      {renameTarget && (
        <RenameRoomModal room={renameTarget} onClose={closeRenameModal} onSaved={handleRenamed} />
      )}
      {deleteTarget && (
        <DeleteRoomModal room={deleteTarget} onClose={closeDeleteModal} onDeleted={handleDeleted} />
      )}
    </div>
  )
}
