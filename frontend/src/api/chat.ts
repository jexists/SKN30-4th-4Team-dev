import { apiPost } from './client'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  answer: string
  response_time_ms: number
}

/** RAG 답변 생성. history 로 이전 대화 맥락을 함께 보낸다(멀티턴). */
export function sendChat(message: string, history: ChatTurn[] = []): Promise<ChatResult> {
  return apiPost<ChatResult>('/api/v1/chat', { message, history })
}
