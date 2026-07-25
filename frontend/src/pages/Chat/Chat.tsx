import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { ApiError } from '../../api/client'
import { sendChat, type ChatTurn } from '../../api/chat'
import { addMessage, createRoom, listMessages, listRooms, type ChatRoom } from '../../api/chatHistory'
import { Close, Info } from '../../components/icons'
import { isAuthConfigured } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import { ChatComposer } from './ChatComposer'
import { EmptyState } from './EmptyState'
import { MessageList } from './MessageList'
import type { Message } from './types'
import styles from './Chat.module.scss'

const TOPICS = ['보증금 반환', '수리비 분쟁', '계약 갱신 청구권', '해지 통보 시점']
const MAX_LEN = 2000
const HISTORY_TURNS = 10 // RAG 에 함께 보내는 최근 맥락 수
const LEGAL_NOTICE_DISMISSED_KEY = 'homeshield:legal-notice-dismissed'

let _id = 0
const newId = () => `m${Date.now()}-${_id++}`

function relTime(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return '방금 전'
  if (min < 60) return `${min}분 전`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}시간 전`
  const day = Math.floor(hr / 24)
  if (day === 1) return '어제'
  if (day < 7) return `${day}일 전`
  return new Date(iso).toLocaleDateString('ko-KR')
}

const toMessage = (r: { id: string; role: string; content: string }): Message => ({
  id: r.id,
  role: r.role === 'ASSISTANT' ? 'assistant' : 'user',
  content: r.content,
})

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

  // 활성 대화 — URL 의 chatId 가 단일 기준이며, 메시지만 로컬 렌더링 상태로 둔다.
  const [messages, setMessages] = useState<Message[]>([])
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [openingRoom, setOpeningRoom] = useState(false)
  const [conversationError, setConversationError] = useState<{
    title: string
    message: string
  } | null>(null)

  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
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
  const roomsSentinel = useRef<HTMLLIElement>(null)
  activeRoomIdRef.current = activeRoomId

  /**
   * 답변 저장 후 그 방을 목록 맨 앞으로 올린다(백엔드가 updated_at 을 갱신한 것과 같은 결과).
   *
   * 예전엔 첫 페이지를 다시 불러왔는데, 그러면 스크롤로 이미 불러온 2페이지 이후가 통째로
   * 사라졌다. 서버에서 실제로 바뀌는 값은 updated_at 하나뿐이라 목록에서 직접 반영한다.
   */
  const touchRoom = useCallback((roomId: string) => {
    setRooms((prev) => {
      const hit = prev.find((r) => r.id === roomId)
      if (!hit) return prev // 아직 불러오지 않은 페이지의 방 — 다음 조회 때 제자리를 찾는다.
      return [
        { ...hit, updated_at: new Date().toISOString() },
        ...prev.filter((r) => r.id !== roomId),
      ]
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    if (!persistent) {
      setInitializing(false)
      return
    }

    setInitializing(true)
    void listRooms()
      .then((page) => {
        if (cancelled) return
        setRooms(page.items)
        setRoomsCursor(page.next_cursor)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setInitializing(false)
      })

    return () => {
      cancelled = true
    }
  }, [persistent])

  // URL 의 chatId 가 현재 대화의 단일 기준이다. 직접 접근·새로고침·브라우저
  // 뒤로가기/앞으로가기로 값이 바뀔 때마다 해당 방을 다시 조회한다.
  useEffect(() => {
    let cancelled = false
    setInput('')
    setMessagesCursor(null)
    setLoadingOlder(false)
    setConversationError(null)

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
      setConversationError({
        title: '대화에 접근할 수 없습니다.',
        message: '로그인 상태와 채팅 저장소 설정을 확인해 주세요.',
      })
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
        // 401 이면 client.ts 가 이미 로그아웃 처리했고 곧 로그인 화면으로 넘어간다.
        // 여기서 "잠시 후 다시" 같은 안내를 띄우면 원인을 오해하게 만든다.
        if (error instanceof ApiError && error.code === 401) return
        if (error instanceof ApiError && (error.code === 403 || error.code === 404)) {
          setConversationError({
            title: '대화에 접근할 수 없습니다.',
            message: '존재하지 않거나 접근 권한이 없는 채팅입니다.',
          })
          return
        }
        setConversationError({
          title: '대화를 불러오지 못했습니다.',
          message: '잠시 후 다시 시도해 주세요.',
        })
      })
      .finally(() => {
        if (!cancelled) setOpeningRoom(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeRoomId, persistent])

  // 방 목록 무한스크롤 — 사이드바 목록 끝 sentinel.
  useEffect(() => {
    const sentinel = roomsSentinel.current
    const root = sidebarRef.current
    if (!sentinel || !root || !roomsCursor) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && roomsCursor && !loadingRooms) {
          setLoadingRooms(true)
          listRooms(roomsCursor)
            .then((page) => {
              setRooms((prev) => [...prev, ...page.items])
              setRoomsCursor(page.next_cursor)
            })
            .catch(() => {})
            .finally(() => setLoadingRooms(false))
        }
      },
      { root, rootMargin: '120px' },
    )
    io.observe(sentinel)
    return () => io.disconnect()
  }, [roomsCursor, loadingRooms])

  function newChat() {
    if (activeRoomId) {
      navigate('/chat')
      return
    }
    setMessages([])
    setMessagesCursor(null)
    setConversationError(null)
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

  function openRoom(roomId: string) {
    if (roomId === activeRoomId) return
    navigate(`/chat/${encodeURIComponent(roomId)}`)
  }

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
      .catch(() => {})
      .finally(() => setLoadingOlder(false))
  }, [activeRoomId, messagesCursor, loadingOlder])

  const onStreamingDone = useCallback((id: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)))
  }, [])

  async function submitQuestion(text: string, regenerate = false) {
    const q = text.trim()
    if (!q || sending) return

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
            ) : rooms.length === 0 ? (
              <p className={styles.sideEmpty}>아직 대화가 없어요. 아래에 질문을 입력해 시작해보세요.</p>
            ) : (
              <ul className={styles.historyList}>
                {rooms.map((r) => (
                  <li key={r.id}>
                    <button
                      className={`${styles.historyItem} ${
                        activeRoomId === r.id ? styles.historyActive : ''
                      }`}
                      aria-current={activeRoomId === r.id ? 'true' : undefined}
                      onClick={() => openRoom(r.id)}
                    >
                      <span className={styles.historyTitle}>{r.title || '새 대화'}</span>
                      <span className={styles.historyTime}>{relTime(r.updated_at)}</span>
                    </button>
                  </li>
                ))}
                {/* 무한스크롤 감시 지점 */}
                {roomsCursor && <li ref={roomsSentinel} className={styles.roomsSentinel} />}
              </ul>
            )}
          </div>

          <div className={styles.suggest}>
            <h3 className={styles.suggestTitle}>추천 주제</h3>
            <div className={styles.chips}>
              {TOPICS.map((t) => (
                <button key={t} className={styles.chip} onClick={() => setInput(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* ── 채팅 영역 ── */}
        <section className={styles.chat}>
          {showLegalNotice && !showEmpty && !conversationError && (
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

          {conversationError ? (
            <div className={styles.conversationError} role="alert">
              <h2 className={styles.conversationErrorTitle}>{conversationError.title}</h2>
              <p className={styles.conversationErrorMessage}>{conversationError.message}</p>
              <button type="button" className={styles.conversationErrorAction} onClick={newChat}>
                새 대화 시작하기
              </button>
            </div>
          ) : showEmpty ? (
            <EmptyState onExample={(q) => void submitQuestion(q)} />
          ) : (
            <MessageList
              key={activeRoomId ?? 'new'}
              messages={messages}
              sending={sending}
              isLoading={openingRoom}
              isLoadingOlder={loadingOlder}
              hasMoreOlder={messagesCursor !== null}
              onLoadOlder={loadOlder}
              onStreamingDone={onStreamingDone}
              onRegenerate={regenerate}
            />
          )}

          {!conversationError && (
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
    </div>
  )
}
