import { supabase } from '../config/supabase'

/**
 * 채팅 기록(chat_room / chat_message) 접근 — Supabase 직접 호출.
 *
 * RLS 로 "본인 채팅만" 읽고 쓴다(로그인 세션 필요). chat_room.user_id 는 DB 기본값
 * auth.uid() 로 자동 채워지므로 insert 시 title 만 넘긴다.
 */

export type DbRole = 'USER' | 'ASSISTANT' | 'SYSTEM'

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

function db() {
  if (!supabase) throw new Error('Supabase 가 설정되지 않았습니다.')
  return supabase
}

/** 내 채팅방 목록 (최신순). */
export async function listRooms(): Promise<ChatRoom[]> {
  const { data, error } = await db()
    .from('chat_room')
    .select('id, title, updated_at')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ChatRoom[]
}

/** 새 채팅방 생성 (title = 첫 질문 요약). user_id 는 DB 기본값으로 채워진다. */
export async function createRoom(title: string): Promise<ChatRoom> {
  const { data, error } = await db()
    .from('chat_room')
    .insert({ title })
    .select('id, title, updated_at')
    .single()
  if (error) throw error
  return data as ChatRoom
}

/** 특정 방의 메시지 (오래된 → 최신). */
export async function listMessages(roomId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await db()
    .from('chat_message')
    .select('id, role, content, created_at')
    .eq('chat_room_id', roomId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ChatMessageRow[]
}

/** 메시지 저장. */
export async function addMessage(
  roomId: string,
  role: DbRole,
  content: string,
  responseTime?: number,
): Promise<void> {
  const { error } = await db()
    .from('chat_message')
    .insert({ chat_room_id: roomId, role, content, response_time: responseTime ?? null })
  if (error) throw error
}

/** 방의 updated_at 갱신 (목록 최신순 정렬용). */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db()
    .from('chat_room')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', roomId)
  if (error) throw error
}
