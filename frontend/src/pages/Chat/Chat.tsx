import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { sendChat, type ChatTurn } from '../../api/chat'
import { addMessage, createRoom, listMessages, listRooms, type ChatRoom } from '../../api/chatHistory'
import { isRetryable } from '../../api/apiErrorHandler'
import { ErrorState } from '../../components/ErrorState/ErrorState'
import { Chat as ChatIcon, ChevronDown, Close, Info } from '../../components/icons'
import { isAuthConfigured } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import { ChatComposer } from './ChatComposer'
import { ChatRoomItem } from './ChatRoomItem'
import { DeleteRoomModal } from './DeleteRoomModal'
import { EmptyState } from './EmptyState'
import { MessageList } from './MessageList'
import { RenameRoomModal } from './RenameRoomModal'
import { groupRoomsByDate } from './roomGroups'
import { TOPICS, topicById } from './topics'
import type { Message } from './types'
import styles from './Chat.module.scss'

const MAX_LEN = 2000
const HISTORY_TURNS = 10 // RAG 에 함께 보내는 최근 맥락 수
const LEGAL_NOTICE_DISMISSED_KEY = 'homeshield:legal-notice-dismissed'

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
 * - `failed` — 조회 실패. 원인 안내는 공통 오류 모달이 이미 했고, 여기선 재시도만 준다
 *   (재시도를 보일지는 공통 isRetryable 이 정한다).
 */
type ConversationBlock = { reason: 'unavailable' } | { reason: 'failed'; error: unknown } | null

export function Chat() {
  const { isAuthed } = useAuth()
  const navigate = useNavigate()
  const { chatId } = useParams<{ chatId: string }>()
  const persistent = isAuthed && isAuthConfigured // 로그인 + Supabase 설정 시 DB 저장
  const activeRoomId = chatId ?? null

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
  const [sending, setSending] = useState(false)
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
  const sidebarRef = useRef<HTMLElement>(null)
  const roomsSentinel = useRef<HTMLDivElement>(null)
  activeRoomIdRef.current = activeRoomId

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
    void listMessages(activeRoomId)
      .then((page) => {
        if (cancelled) return
        setMessages(page.items.map(toMessage))
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

  // 방 목록 무한스크롤 — 사이드바 목록 끝 sentinel.
  // 실패했으면 관찰을 멈춘다. sentinel 이 계속 보이는 상태라 그냥 두면 실패한 요청을
  // 무한히 다시 쏜다(오류 모달도 그만큼 다시 뜬다) — "다시 시도" 를 누를 때 재개한다.
  useEffect(() => {
    const sentinel = roomsSentinel.current
    const root = sidebarRef.current
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
  }, [roomsCursor, loadingRooms, roomsError])

  function newChat() {
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

  const openRoom = useCallback(
    (roomId: string) => {
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
    if (!q || sending) return

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
    setSending(true)

    // regenerate 면 끝에 붙어있던 에러 버블을 제거하고 다시 시도한다.
    const dropTrailingError = (list: Message[]) =>
      regenerate && list[list.length - 1]?.error ? list.slice(0, -1) : list

    let roomId = activeRoomId
    try {
      if (persistent && !roomId) {
        const room = await createRoom(q.slice(0, 40)) // 첫 질문을 방 제목으로
        roomId = room.id
        setRooms((prev) => [room, ...prev.filter((item) => item.id !== room.id)])
      }
      if (persistent && roomId && !regenerate) await addMessage(roomId, 'USER', q)
      if (persistent && roomId && activeRoomId === null) {
        createdRoomIdRef.current = roomId
        activeRoomIdRef.current = roomId
        navigate(`/chat/${encodeURIComponent(roomId)}`)
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
      setSending(false)
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

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {/* ── 사이드바 ── */}
        <aside className={styles.sidebar} ref={sidebarRef}>
          <div className={styles.sidebarTop}>
            <div className={styles.sideHead}>
              <h2 className={styles.sideTitle}>대화 기록</h2>
              {persistent && (
                <button className={styles.newChat} onClick={newChat}>
                  + 새 대화
                </button>
              )}
            </div>

            {!persistent ? (
              <p className={styles.sideEmpty}>로그인하면 대화가 저장되어 언제든 다시 볼 수 있어요.</p>
            ) : (
              <>
                {groups.map((group) => (
                  <div key={group.label} className={styles.historyGroup}>
                    <h3 className={styles.historyGroupLabel}>{group.label}</h3>
                    <ul className={styles.historyList}>
                      {group.rooms.map((room) => (
                        <ChatRoomItem
                          key={room.id}
                          room={room}
                          active={activeRoomId === room.id}
                          onOpen={openRoom}
                          onRename={handleRename}
                          onDelete={handleDelete}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
                {/* 무한스크롤 감시 지점은 날짜 그룹 목록과 분리해 유효한 마크업을 유지한다. */}
                {roomsCursor && <div ref={roomsSentinel} className={styles.roomsSentinel} />}

                {/* 실패가 Empty State 를 이긴다 — 서버 장애를 "대화가 없다" 로 보여주면 안 된다. */}
                {roomsError !== null ? (
                  <ErrorState
                    message="대화 기록을 불러오지 못했습니다."
                    onRetry={isRetryable(roomsError) ? retryRooms : undefined}
                  />
                ) : rooms.length === 0 ? (
                  // 목록은 최대한 조용하게 — 안내는 가운데 Hero 가 이미 하고 있다.
                  <div className={styles.roomsEmpty}>
                    <ChatIcon className={styles.roomsEmptyIcon} />
                    <p className={styles.roomsEmptyText}>대화가 없습니다.</p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className={styles.suggest}>
            <button
              type="button"
              className={styles.suggestToggle}
              aria-expanded={suggestOpen}
              aria-controls="chat-suggest-chips"
              onClick={() => setSuggestOpen((open) => !open)}
            >
              <h3 className={styles.suggestTitle}>추천 주제</h3>
              <ChevronDown
                className={`${styles.suggestChevron} ${
                  suggestOpen ? styles.suggestChevronOpen : ''
                }`}
              />
            </button>
            {suggestOpen && (
              <div id="chat-suggest-chips" className={styles.chips}>
                {TOPICS.map((topic) => (
                  <button
                    key={topic.id}
                    type="button"
                    className={`${styles.chip} ${topicId === topic.id ? styles.chipActive : ''}`}
                    aria-pressed={topicId === topic.id}
                    onClick={() => selectTopic(topic.id)}
                  >
                    {topic.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

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
            <ErrorState message="로그인 상태와 채팅 저장소 설정을 확인해 주세요." />
          ) : conversationBlock ? (
            <ErrorState
              message="대화를 불러오지 못했습니다."
              onRetry={isRetryable(conversationBlock.error) ? retryLoadMessages : undefined}
            />
          ) : showEmpty ? (
            <EmptyState topic={topicById(topicId)} onExample={(q) => void submitQuestion(q)} />
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
            />
          )}

          {!conversationBlock && (
            <ChatComposer
              value={input}
              onChange={setInput}
              onSubmit={() => void submitQuestion(input)}
              disabled={sending || openingRoom}
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
