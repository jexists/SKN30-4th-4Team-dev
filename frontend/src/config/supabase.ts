import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { ENV } from './env'

/**
 * Supabase Auth 클라이언트.
 *
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정된 경우에만 생성한다.
 * 비어 있으면 `null` — 회원가입/로그인 화면이 "설정 필요" 안내를 띄우고,
 * 앱의 나머지 부분은 그대로 동작한다(키 없이도 빌드·실행 가능).
 */
export const supabase: SupabaseClient | null =
  ENV.supabaseUrl && ENV.supabaseAnonKey ? createClient(ENV.supabaseUrl, ENV.supabaseAnonKey) : null

/** 인증 설정이 켜져 있는지. */
export const isAuthConfigured = supabase !== null
