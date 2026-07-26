import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { kakaoLogin } from '../../api/kakaoAuth'
import { consumeKakaoReturnTo, setKakaoReturnTo } from '../../auth/kakaoOAuth'
import { Shield } from '../../components/icons'
import { showToast } from '../../components/Toast/toastStore'
import { BRAND } from '../../config/env'
import { supabase } from '../../config/supabase'
import { signIn } from '../../hooks/useAuth'
import styles from './AuthCallback.module.scss'

type ExchangeResult = Awaited<
  ReturnType<NonNullable<typeof supabase>['auth']['exchangeCodeForSession']>
>

const exchangesByCode = new Map<string, Promise<ExchangeResult>>()

function exchangeCodeOnce(code: string): Promise<ExchangeResult> {
  if (!supabase) return Promise.reject(new Error('로그인 서비스가 설정되지 않았습니다.'))

  const pending = exchangesByCode.get(code)
  if (pending) return pending

  const exchange = supabase.auth.exchangeCodeForSession(code)
  exchangesByCode.set(code, exchange)
  return exchange
}
function callbackError(search: string, hash: string): string | null {
  const query = new URLSearchParams(search)
  const fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  return (
    query.get('error_description') ??
    query.get('error') ??
    fragment.get('error_description') ??
    fragment.get('error')
  )
}

export function AuthCallback() {
  const { search, hash } = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    let active = true

    async function finishLogin() {
      try {
        const oauthError = callbackError(search, hash)
        if (oauthError) throw new Error(oauthError)
        if (!supabase) throw new Error('로그인 서비스가 설정되지 않았습니다.')

        const code = new URLSearchParams(search).get('code')
        if (!code) throw new Error('유효하지 않은 카카오 로그인 응답입니다.')

        const { data, error } = await exchangeCodeOnce(code)
        if (error || !data.session) {
          throw error ?? new Error('카카오 로그인 세션을 생성하지 못했습니다.')
        }
        if (!active) return

        signIn(data.session.access_token)
        const result = await kakaoLogin()
        if (!active) return

        const returnTo = consumeKakaoReturnTo()
        if (result.status === 'signup_required') {
          setKakaoReturnTo(returnTo)
          void navigate('/signup?mode=kakao', { replace: true })
          return
        }
        void navigate(returnTo, { replace: true })
      } catch (error) {
        if (!active) return
        const message =
          error instanceof Error && error.message
            ? error.message
            : '카카오 로그인에 실패했습니다. 다시 시도해 주세요.'
        showToast(message, 'error')
        void navigate('/login', { replace: true })
      }
    }

    void finishLogin()
    return () => {
      active = false
    }
  }, [hash, navigate, search])

  return (
    <main className={styles.page}>
      <div className={styles.card} role="status" aria-live="polite">
        <span className={styles.badge}>
          <Shield className={styles.mark} />
        </span>
        <h1>{BRAND.nameKo} 로그인 처리 중</h1>
        <p>카카오 인증 정보를 안전하게 확인하고 있습니다.</p>
      </div>
    </main>
  )
}
