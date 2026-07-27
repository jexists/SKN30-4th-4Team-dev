import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { authStorage } from './authStorage'
import { ENV } from './env'

/**
 * Supabase Auth 클라이언트.
 *
 * VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 설정된 경우에만 생성한다.
 * 비어 있으면 `null` — 회원가입/로그인 화면이 "설정 필요" 안내를 띄우고,
 * 앱의 나머지 부분은 그대로 동작한다(키 없이도 빌드·실행 가능).
 *
 * storage: "로그인 상태 유지" 선택에 따라 localStorage/sessionStorage 를 고르는 어댑터.
 * persistSession·autoRefreshToken 은 기본값(true) 유지 — 세션 자동 갱신은 useAuth 의
 * onAuthStateChange 가 받는다.
 */
export const supabase: SupabaseClient | null =
  ENV.supabaseUrl && ENV.supabaseAnonKey
    ? createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
        auth: {
          storage: authStorage,
          flowType: 'pkce',
          // /auth/callback이 exchangeCodeForSession을 직접 호출하므로 자동 교환을 끈다.
          // 둘 다 켜면 먼저 실행된 쪽이 verifier를 소비해 "PKCE code verifier not found"가 난다.
          detectSessionInUrl: false,
        },
      })
    : null

/** 인증 설정이 켜져 있는지. */
export const isAuthConfigured = supabase !== null
