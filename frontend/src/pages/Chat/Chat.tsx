import { useCallback, useEffect, useRef, useState } from 'react'

import { ApiError } from '../../api/client'
import { sendChat, type ChatTurn } from '../../api/chat'
import {
  addMessage,
  createRoom,
  listMessages,
  listRooms,
  touchRoom,
  type ChatRoom,
} from '../../api/chatHistory'
import { Info, Paperclip, Send, Shield, User } from '../../components/icons'
import { BRAND } from '../../config/env'
import { isAuthConfigured } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './Chat.module.scss'

const TOPICS = ['보증금 반환', '수리비 분쟁', '계약 갱신 청구권', '해지 통보 시점']
const MAX_LEN = 2000

const GREETING = `안녕하세요! ${BRAND.name} AI 법률 어시스턴트입니다. 주택임대차보호법에 따른 귀하의 권리를 이해하실 수 있도록 도와드리겠습니다. 오늘 임대차 계약과 관련하여 어떤 도움이 필요하신가요?`

type Role = 'user' | 'assistant'
interface Message {
  id: string
  role: Role
  content: string
  error?: boolean
}

let _id = 0
const newId = () => `m${Date.now()}-${_id++}`
const greetingMsg = (): Message => ({ id: 'seed', role: 'assistant', content: GREETING })

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

export function Chat() {
  const { isAuthed } = useAuth()
  const persistent = isAuthed && isAuthConfigured // 로그인 + Supabase 설정 시 DB 저장

  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([greetingMsg()])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const refreshRooms = useCallback(() => {
    if (!persistent) return
    listRooms()
      .then(setRooms)
      .catch(() => {})
  }, [persistent])

  // 로그인 시 채팅방 목록 로드
  useEffect(() => {
    refreshRooms()
  }, [refreshRooms])

  // 새 메시지·타이핑 시 맨 아래로 스크롤
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  function newChat() {
    setActiveRoomId(null)
    setMessages([greetingMsg()])
    setInput('')
  }

  async function openRoom(roomId: string) {
    if (roomId === activeRoomId) return
    setActiveRoomId(roomId)
    try {
      const rows = await listMessages(roomId)
      setMessages(
        rows.map((r) => ({
          id: r.id,
          role: r.role === 'ASSISTANT' ? 'assistant' : 'user',
          content: r.content,
        })),
      )
    } catch {
      setMessages([{ id: newId(), role: 'assistant', content: '대화를 불러오지 못했어요.', error: true }])
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return

    // 이번 턴 이전까지의 맥락(인사말·에러 제외, 최근 10개)을 RAG 에 전달
    const history: ChatTurn[] = messages
      .filter((m) => m.id !== 'seed' && !m.error)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }))

    setMessages((m) => [...m, { id: newId(), role: 'user', content: text }])
    setInput('')
    setSending(true)

    let roomId = activeRoomId
    try {
      if (persistent && !roomId) {
        const room = await createRoom(text.slice(0, 40)) // 첫 질문을 방 제목으로
        roomId = room.id
        setActiveRoomId(roomId)
      }
      if (persistent && roomId) await addMessage(roomId, 'USER', text)

      const res = await sendChat(text, history)
      setMessages((m) => [...m, { id: newId(), role: 'assistant', content: res.answer }])

      if (persistent && roomId) {
        await addMessage(roomId, 'ASSISTANT', res.answer, res.response_time_ms)
        await touchRoom(roomId)
        refreshRooms()
      }
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : '답변을 받지 못했어요. 백엔드 서버가 실행 중인지 확인하고 다시 시도해 주세요.'
      setMessages((m) => [...m, { id: newId(), role: 'assistant', content: msg, error: true }])
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {/* ── 사이드바 ── */}
        <aside className={styles.sidebar}>
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
                      onClick={() => void openRoom(r.id)}
                    >
                      <span className={styles.historyTitle}>{r.title || '새 대화'}</span>
                      <span className={styles.historyTime}>{relTime(r.updated_at)}</span>
                    </button>
                  </li>
                ))}
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
          <div className={styles.notice}>
            <Info className={styles.noticeIcon} />
            <span>
              법적 고지: 본 서비스는 공공 기록을 바탕으로 한 자동 분석 정보를 제공하며, 정식 법률
              대리나 자문을 대신하지 않습니다.
            </span>
          </div>

          <div className={styles.thread} ref={threadRef}>
            {messages.map((m) =>
              m.role === 'assistant' ? (
                <div className={styles.msgRow} key={m.id}>
                  <div className={styles.botAvatar}>
                    <Shield />
                  </div>
                  <div className={styles.msgCol}>
                    <div className={`${styles.bubbleBot} ${m.error ? styles.bubbleError : ''}`}>
                      {m.content}
                    </div>
                    <span className={styles.meta}>{BRAND.name} 봇</span>
                  </div>
                </div>
              ) : (
                <div className={`${styles.msgRow} ${styles.msgUser}`} key={m.id}>
                  <div className={styles.msgCol}>
                    <div className={styles.bubbleUser}>{m.content}</div>
                    <span className={styles.meta}>사용자</span>
                  </div>
                  <div className={styles.userAvatar}>
                    <User />
                  </div>
                </div>
              ),
            )}

            {sending && (
              <div className={styles.msgRow}>
                <div className={styles.botAvatar}>
                  <Shield />
                </div>
                <div className={styles.msgCol}>
                  <div className={`${styles.bubbleBot} ${styles.typing}`} aria-label="답변 작성 중">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 입력 영역 */}
          <div className={styles.composer}>
            <form
              className={styles.inputBar}
              onSubmit={(e) => {
                e.preventDefault()
                void send()
              }}
            >
              <button type="button" className={styles.attachBtn} aria-label="파일 첨부">
                <Paperclip />
              </button>
              <textarea
                className={styles.input}
                placeholder="법률적인 상황을 설명해주세요..."
                value={input}
                maxLength={MAX_LEN}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <button
                type="submit"
                className={styles.sendBtn}
                aria-label="전송"
                disabled={!input.trim() || sending}
              >
                <Send />
              </button>
            </form>
            <div className={styles.composerNote}>
              <span>AI는 실수를 할 수 있습니다. 중요한 법률 정보는 전문가와 확인하세요.</span>
              <span className={styles.counter}>
                {input.length}/{MAX_LEN}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
