import { useEffect, useRef, useState } from 'react'

import { ApiError } from '../../api/client'
import { sendChat } from '../../api/chat'
import { SiteHeader } from '../../components/SiteHeader/SiteHeader'
import { Info, Paperclip, Send, Shield, User } from '../../components/icons'
import styles from './Chat.module.scss'

const HISTORY = [
  { title: '전세보증금 미반환 문제', time: '2시간 전', active: true },
  { title: '계약 갱신 관련 Q&A', time: '어제', active: false },
  { title: '수리비 부담 책임 소재', time: '2024년 3월 12일', active: false },
]

const TOPICS = ['보증금 반환', '수리비 분쟁', '계약 갱신 청구권', '해지 통보 시점']

const MAX_LEN = 2000

const GREETING =
  '안녕하세요! HomeShield AI 법률 어시스턴트입니다. 주택임대차보호법에 따른 귀하의 권리를 이해하실 수 있도록 도와드리겠습니다. 오늘 임대차 계약과 관련하여 어떤 도움이 필요하신가요?'

type Role = 'user' | 'assistant'
interface Message {
  id: string
  role: Role
  content: string
  error?: boolean
}

let _id = 0
const newId = () => `m${Date.now()}-${_id++}`

export function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'seed', role: 'assistant', content: GREETING },
  ])
  const [threadId, setThreadId] = useState<string>()
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  // 새 메시지·타이핑 상태 변화 시 맨 아래로 스크롤
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  async function send() {
    const text = input.trim()
    if (!text || sending) return

    setMessages((m) => [...m, { id: newId(), role: 'user', content: text }])
    setInput('')
    setSending(true)
    try {
      const res = await sendChat(text, threadId)
      setThreadId(res.thread_id)
      setMessages((m) => [...m, { id: newId(), role: 'assistant', content: res.answer }])
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
      <SiteHeader />

      <div className={styles.shell}>
        {/* ── 사이드바 ── */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarTop}>
            <h2 className={styles.sideTitle}>대화 기록</h2>
            <ul className={styles.historyList}>
              {HISTORY.map((h) => (
                <li key={h.title}>
                  <button
                    className={`${styles.historyItem} ${h.active ? styles.historyActive : ''}`}
                  >
                    <span className={styles.historyTitle}>{h.title}</span>
                    <span className={styles.historyTime}>{h.time}</span>
                  </button>
                </li>
              ))}
            </ul>
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
        <main className={styles.chat}>
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
                    <span className={styles.meta}>HomeShield 봇</span>
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
        </main>
      </div>
    </div>
  )
}
