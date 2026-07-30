import type { Page } from '../types/api'
import { apiDelete, apiGet, apiPost, apiPut, type ApiOptions } from './client'

/**
 * 채팅 기록(chat_room / chat_message) 접근 — 백엔드 API 경유.
 *
 * 예전엔 Supabase 를 직접 호출했지만, 지금은 공통 client.ts 로 백엔드(/api/v1/chat/rooms...)를
 * 부른다. 인증 토큰은 client.ts 의 authHeader 가 자동으로 붙이고, 소유권("내 방만")은 백엔드가
 * JWT 의 sub 로 검증한다. 방 last_chat_at 갱신은 메시지 저장 시 백엔드가 함께 처리한다.
 *
 * 목록 조회는 커서 기반 페이지네이션(초기 30개 + 스크롤 시 다음 페이지)이다. 커서는 불투명
 * 문자열이라 저장했다가 다음 요청에 그대로 넘긴다(next_cursor 가 null 이면 끝).
 */

export type DbRole = 'USER' | 'ASSISTANT' | 'SYSTEM'

// Page<T> 는 알림·분석 목록도 쓰게 되어 types/api.ts 로 옮겼다.
// 기존 import 경로(`from '../api/chatHistory'`)가 깨지지 않도록 여기서 다시 내보낸다.
export type { Page }

export interface ChatRoom {
  id: string
  title: string | null
  last_chat_at: string
  updated_at: string
  /**
   * 이 방에 첨부된 계약서 분석. 붙어 있으면 이후 질문에 계약서 맥락이 함께 들어간다.
   * 방 정보로 내려오므로 새로고침하거나 대화를 다시 열어도 첨부 칩이 복원된다.
   */
  analysis_job_id: string | null
  /** 칩에 표시할 파일명. 첨부가 없으면 null. */
  analysis_file_name: string | null
  last_message_preview: string | null
}

export interface ChatMessageRow {
  id: string
  role: DbRole
  content: string
  created_at: string
}

const PAGE_SIZE = 30

/** 제목 입력 상한 — 백엔드 UpdateRoomTitleIn/CreateRoomIn 과 동일. */
export const ROOM_TITLE_MAX = 200

function withCursor(path: string, cursor?: string | null, limit: number = PAGE_SIZE): string {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return `${path}?${params.toString()}`
}

/** 내 채팅방 목록 (최신순, 한 페이지). cursor 로 다음(과거) 페이지. */
export function listRooms(cursor?: string | null, limit: number = PAGE_SIZE): Promise<Page<ChatRoom>> {
  return apiGet<Page<ChatRoom>>(withCursor('/api/v1/chat/rooms', cursor, limit))
}

/** 새 채팅방 생성 (title = 첫 질문 요약). */
export function createRoom(title: string): Promise<ChatRoom> {
  return apiPost<ChatRoom>('/api/v1/chat/rooms', { title })
}

/** 제목만 수정한다. 마지막 대화 시각은 바뀌지 않아 목록 순서가 유지된다. */
export function updateRoomTitle(roomId: string, title: string): Promise<ChatRoom> {
  return apiPut<ChatRoom>(`/api/v1/chat/rooms/${roomId}/title`, { title })
}

/** 채팅방을 soft delete 하고 삭제된 방 DTO 를 받는다. */
export function deleteRoom(roomId: string): Promise<ChatRoom> {
  return apiDelete<ChatRoom>(`/api/v1/chat/rooms/${roomId}`)
}

/**
 * 특정 방의 메시지 한 페이지. cursor 없으면 최신 30개(오름차순), cursor 로 더 과거를 가져온다.
 * next_cursor 는 "이보다 과거가 더 있음"을 뜻한다.
 *
 * 대화를 처음 여는 호출은 실패해도 화면 전체가 그 사실을 이미 말하고 있으므로,
 * `{ silent: true }` 로 공통 오류 모달을 끌 수 있다(Chat 화면이 그렇게 쓴다).
 */
export function listMessages(
  roomId: string,
  cursor?: string | null,
  options?: ApiOptions,
): Promise<Page<ChatMessageRow>> {
  return apiGet<Page<ChatMessageRow>>(
    withCursor(`/api/v1/chat/rooms/${roomId}/messages`, cursor),
    options,
  )
}

/**
 * 완료된 계약서 분석을 방에 첨부한다. 분석이 아직 끝나지 않았으면 409 다.
 * 첨부 후에는 그 방의 모든 질문에 계약서 맥락이 자동으로 들어간다.
 */
export function attachDocument(roomId: string, analysisJobId: string): Promise<ChatRoom> {
  return apiPost<ChatRoom>(`/api/v1/chat/rooms/${roomId}/document`, {
    analysis_job_id: analysisJobId,
  })
}

/** 첨부만 해제한다. 분석과 위험 보고서는 그대로 남는다. */
export function detachDocument(roomId: string): Promise<ChatRoom> {
  return apiDelete<ChatRoom>(`/api/v1/chat/rooms/${roomId}/document`)
}

/** 메시지 저장. 방 last_chat_at/updated_at 갱신은 백엔드가 함께 처리한다. */
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
