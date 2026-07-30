import { apiPost } from './client'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  answer: string
  response_time_ms: number
}

/**
 * RAG 답변 생성. history 로 이전 대화 맥락을 함께 보낸다(멀티턴).
 *
 * roomId 를 넘기면 그 방에 첨부된 계약서를 서버가 DB 에서 읽어 답변 근거에 함께 넣는다.
 * **계약서 본문은 요청으로 왕복하지 않는다** — 수만 자라 매 턴 실어 보낼 수 없고,
 * 방에 붙어 있는 것이 원본이므로 id 만 넘기는 편이 정확하다.
 *
 * 실패는 공통 오류 모달이 아니라 **대화창의 오류 말풍선 + 재생성 버튼**으로 보여준다.
 * 질문 맥락이 남은 자리에서 바로 다시 시도하는 편이 낫고, 모달은 그 흐름을 끊는다.
 */
export function sendChat(
  message: string,
  history: ChatTurn[] = [],
  roomId?: string | null,
): Promise<ChatResult> {
  return apiPost<ChatResult>(
    '/api/v1/chat',
    { message, history, room_id: roomId ?? null },
    { silent: true },
  )
}
