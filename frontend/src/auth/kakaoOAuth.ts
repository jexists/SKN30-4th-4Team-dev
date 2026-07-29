import { supabase } from '../config/supabase'

const RETURN_TO_KEY = 'homeshield.kakao.returnTo'
const INTENT_KEY = 'homeshield.kakao.intent'
const DEFAULT_RETURN_TO = '/mypage'

/**
 * 카카오 인증을 시작한 화면의 의도. OAuth 리다이렉트로 화면을 떠났다 돌아오면 어디서
 * 출발했는지 알 수 없으므로 returnTo 와 같은 방식으로 실어 보낸다.
 *
 * 콜백에서 "가입된 계정 없음" 을 만났을 때 처리가 갈린다 — 로그인에서 왔으면 가입할지
 * 되물어야 하지만, 회원가입에서 왔으면 이미 가입하겠다고 누른 것이라 되묻지 않는다.
 */
export type KakaoIntent = 'login' | 'signup'

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

/** 시작 화면의 의도를 꺼낸다(한 번만). 값이 없거나 이상하면 되묻는 쪽이 안전하므로 login. */
export function consumeKakaoIntent(): KakaoIntent {
  const intent = sessionStorage.getItem(INTENT_KEY)
  sessionStorage.removeItem(INTENT_KEY)
  return intent === 'signup' ? 'signup' : 'login'
}

export async function startKakaoOAuth(
  returnTo: string = DEFAULT_RETURN_TO,
  intent: KakaoIntent = 'login',
): Promise<void> {
  if (!supabase) {
    throw new Error('카카오 로그인 서비스가 설정되지 않았습니다.')
  }

  setKakaoReturnTo(returnTo)
  // 이전 시도의 값이 남아 흐름이 뒤바뀌지 않도록 login 일 때도 반드시 덮어쓴다.
  sessionStorage.setItem(INTENT_KEY, intent)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'kakao',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw error
}
