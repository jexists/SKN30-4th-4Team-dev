import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { abandonKakaoSignup, kakaoLogin } from '../../api/kakaoAuth'
import { consumeKakaoReturnTo, setKakaoReturnTo } from '../../auth/kakaoOAuth'
import { Modal } from '../../components/Modal/Modal'
import { showToast } from '../../components/Toast/toastStore'
import { supabase } from '../../config/supabase'
import { signIn, signOut } from '../../hooks/useAuth'
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
  const [signupPromptOpen, setSignupPromptOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const signupButtonRef = useRef<HTMLButtonElement>(null)

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
          setSignupPromptOpen(true)
          return
        }
        void navigate(returnTo, { replace: true })
      } catch (error) {
        if (!active) return
        const message =
          error instanceof Error && error.message
            ? error.message
            : '카카오 로그인에 실패했습니다. 다시 시도해 주세요.'
        // 위에서 signIn 으로 세션을 잡아둔 뒤 실패했을 수 있다. 그대로 두면 탈퇴 계정처럼
        // 서버가 거절한 사용자가 '로그인된 상태'로 남으므로 반드시 세션을 되돌린다.
        signOut()
        showToast(message, 'error')
        void navigate('/login', { replace: true })
      }
    }

    void finishLogin()
    return () => {
      active = false
    }
  }, [hash, navigate, search])

  function continueSignup() {
    setSignupPromptOpen(false)
    void navigate('/signup?mode=kakao', { replace: true })
  }

  async function cancelSignup() {
    if (cancelling) return

    setCancelling(true)
    try {
      await abandonKakaoSignup()
      consumeKakaoReturnTo()
      signOut()
      void navigate('/login', { replace: true })
    } catch {
      setCancelling(false)
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.status} role="status" aria-live="polite">
        <span className={styles.spinner} aria-hidden="true" />
        <p>로그인 정보를 확인하고 있어요.</p>
      </div>

      <Modal
        open={signupPromptOpen}
        onClose={() => void cancelSignup()}
        title="회원가입 안내"
        initialFocusRef={signupButtonRef}
      >
        <p className={styles.promptMessage}>
          회원가입이 되어 있지 않습니다. 회원가입하시겠습니까?
        </p>
        <div className={styles.promptActions}>
          <button
            type="button"
            className={styles.cancelButton}
            onClick={() => void cancelSignup()}
            disabled={cancelling}
          >
            {cancelling ? '처리 중…' : '취소'}
          </button>
          <button
            ref={signupButtonRef}
            type="button"
            className={styles.confirmButton}
            onClick={continueSignup}
            disabled={cancelling}
          >
            회원가입
          </button>
        </div>
      </Modal>
    </main>
  )
}
