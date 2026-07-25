import { apiGet, apiPost } from './client'

/**
 * 채팅 기록(chat_room / chat_message) 접근 — 백엔드 API 경유.
 *
 * 예전엔 Supabase 를 직접 호출했지만, 지금은 공통 client.ts 로 백엔드(/api/v1/chat/rooms...)를
 * 부른다. 인증 토큰은 client.ts 의 authHeader 가 자동으로 붙이고, 소유권("내 방만")은 백엔드가
 * JWT 의 sub 로 검증한다. 방 updated_at 갱신(옛 touchRoom)은 메시지 저장 시 백엔드가 함께 처리한다.
 *
 * 목록 조회는 커서 기반 페이지네이션(초기 30개 + 스크롤 시 다음 페이지)이다. 커서는 불투명
 * 문자열이라 저장했다가 다음 요청에 그대로 넘긴다(next_cursor 가 null 이면 끝).
 */

export type DbRole = 'USER' | 'ASSISTANT' | 'SYSTEM'

/** 커서 페이지네이션 응답 봉투 (백엔드 Page[T] 와 1:1). */
export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

export interface ChatRoom {
  id: string
  title: string | null
  updated_at: string
}

export interface ChatMessageRow {
  id: string
  role: DbRole
  content: string
  created_at: string
}

const PAGE_SIZE = 30

function withCursor(path: string, cursor?: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (cursor) params.set('cursor', cursor)
  return `${path}?${params.toString()}`
}

/** 내 채팅방 목록 (최신순, 한 페이지). cursor 로 다음(과거) 페이지. */
export function listRooms(cursor?: string | null): Promise<Page<ChatRoom>> {
  return apiGet<Page<ChatRoom>>(withCursor('/api/v1/chat/rooms', cursor))
}

/** 새 채팅방 생성 (title = 첫 질문 요약). */
export function createRoom(title: string): Promise<ChatRoom> {
  return apiPost<ChatRoom>('/api/v1/chat/rooms', { title })
}

/**
 * 특정 방의 메시지 한 페이지. cursor 없으면 최신 30개(오름차순), cursor 로 더 과거를 가져온다.
 * next_cursor 는 "이보다 과거가 더 있음"을 뜻한다.
 */
export function listMessages(roomId: string, cursor?: string | null): Promise<Page<ChatMessageRow>> {
  return apiGet<Page<ChatMessageRow>>(withCursor(`/api/v1/chat/rooms/${roomId}/messages`, cursor))
}

/** 메시지 저장. 방 updated_at 갱신은 백엔드가 함께 처리한다. */
export function addMessage(
  roomId: string,
  role: DbRole,
  content: string,
  responseTime?: number,
): Promise<ChatMessageRow> {
  return apiPost<ChatMessageRow>(`/api/v1/chat/rooms/${roomId}/messages`, {
    role,
    content,
    response_time: responseTime ?? null,
  })
}
