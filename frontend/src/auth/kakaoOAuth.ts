import { supabase } from '../config/supabase'

const RETURN_TO_KEY = 'homeshield.kakao.returnTo'
const DEFAULT_RETURN_TO = '/mypage'

function safeInternalPath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return DEFAULT_RETURN_TO
  return path
}

export function setKakaoReturnTo(path: string): void {
  sessionStorage.setItem(RETURN_TO_KEY, safeInternalPath(path))
}

export function consumeKakaoReturnTo(): string {
  const path = safeInternalPath(sessionStorage.getItem(RETURN_TO_KEY))
  sessionStorage.removeItem(RETURN_TO_KEY)
  return path
}

export async function startKakaoOAuth(returnTo: string = DEFAULT_RETURN_TO): Promise<void> {
  if (!supabase) {
    throw new Error('카카오 로그인 서비스가 설정되지 않았습니다.')
  }

  setKakaoReturnTo(returnTo)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw error
}
