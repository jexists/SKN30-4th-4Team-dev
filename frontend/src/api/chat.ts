import { apiPost } from './client'

export interface ChatResult {
  answer: string
  thread_id: string
}

/** 한 턴 전송. threadId 를 넘기면 대화 맥락이 이어진다(멀티턴). */
export function sendChat(message: string, threadId?: string): Promise<ChatResult> {
  return apiPost<ChatResult>('/api/v1/chat', { message, thread_id: threadId })
}
