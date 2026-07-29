import { useId, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { startKakaoOAuth } from '../../auth/kakaoOAuth'
import { Modal } from '../../components/Modal/Modal'
import { Chat, Shield } from '../../components/icons'
import { showToast } from '../../components/Toast/toastStore'
import { keepSignedIn, savedEmail } from '../../config/authStorage'
import { BRAND } from '../../config/env'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './Login.module.scss'

export function Login() {
  const { isAuthed, signIn } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation() as { state: { from?: string; expired?: boolean } | null }
  const from = state?.from ?? '/mypage'

  // 저장된 이메일이 있으면 폼과 체크박스를 그 값으로 초기화한다(없으면 빈 값 · 해제).
  const [email, setEmail] = useState(() => savedEmail.get() ?? '')
  const [password, setPassword] = useState('')
  const [rememberEmail, setRememberEmail] = useState(() => savedEmail.get() !== null)
  const [submitting, setSubmitting] = useState(false)
  const [helpModalOpen, setHelpModalOpen] = useState(false)
  const helpConfirmRef = useRef<HTMLButtonElement>(null)
  const helpBodyId = useId()

  async function handleKakaoLogin() {
    // 아이디 저장 체크박스가 사라졌으므로, 과거 버전에서 false 로 저장돼 있던 사용자가
    // sessionStorage 에 계속 갇히지 않도록 로그인 직전 항상 "유지"로 정규화한다.
    keepSignedIn.set(true)
    setSubmitting(true)
    try {
      await startKakaoOAuth(from)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '카카오 로그인에 실패했습니다. 다시 시도해 주세요.'
      showToast(message, 'error')
      setSubmitting(false)
    }
  }
  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!supabase) {
      showToast(
        '로그인 서비스가 아직 설정되지 않았습니다. (VITE_SUPABASE_* 환경변수 필요)',
        'error',
      )
      return
    }
    if (!email || !password) {
      showToast('이메일과 비밀번호를 입력해주세요.', 'error')
      return
    }

    setSubmitting(true)
    // 카카오 로그인과 같은 이유로, 체크박스 없이도 항상 "유지"로 정규화한다.
    keepSignedIn.set(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      showToast('이메일 또는 비밀번호가 올바르지 않습니다.', 'error')
      setSubmitting(false)
      return
    }
    // 체크됐으면 지금 입력한 이메일로 갱신, 해제됐으면 기존 저장값을 지운다.
    if (rememberEmail) {
      savedEmail.set(email)
    } else {
      savedEmail.clear()
    }
    signIn(data.session.access_token)
    void navigate(from, { replace: true })
  }

  // 이미 로그인한 상태로 들어오면 폼 대신 원래 가려던 화면으로 보낸다.
  if (isAuthed) return <Navigate to={from} replace />

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <div className={styles.card}>
          <div className={styles.brandAnchor}>
            <span className={styles.brandBadge}>
              <Shield className={styles.brandMark} />
            </span>
            <h1 className={styles.title}>반갑습니다, {BRAND.nameKo}입니다</h1>
            <p className={styles.subtitle}>안전한 전세 계약의 시작, 로그인해주세요.</p>
          </div>

          {state?.expired && (
            <p className={styles.redirectNote} role="status">
              세션이 만료되었습니다. 다시 로그인해 주세요.
            </p>
          )}

          <div className={styles.socials}>
            <button
              type="button"
              className={`${styles.social} ${styles.kakao}`}
              onClick={() => void handleKakaoLogin()}
              disabled={submitting}
            >
              <Chat className={styles.socialMark} />
              카카오로 로그인
            </button>
          </div>

          <div className={styles.divider}>
            <span>또는</span>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">
                이메일 주소
              </label>
              <input
                id="email"
                type="email"
                className={styles.input}
                placeholder="example@homeshield.co.kr"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                className={styles.input}
                placeholder="비밀번호를 입력하세요"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className={styles.formRow}>
              <label className={styles.keep}>
                <input
                  type="checkbox"
                  checked={rememberEmail}
                  onChange={(e) => setRememberEmail(e.target.checked)}
                />
                <span>아이디 저장</span>
              </label>
              <button
                type="button"
                className={styles.textLink}
                onClick={() => setHelpModalOpen(true)}
              >
                비밀번호 찾기
              </button>
            </div>

            <button type="submit" className={styles.submit} disabled={submitting}>
              {submitting ? '로그인 중…' : '로그인'}
            </button>
          </form>

          <p className={styles.signup}>
            아직 회원이 아니신가요?
            <Link to="/signup">회원가입</Link>
          </p>
        </div>

        {/* <div className={styles.badges}>
          <span className={styles.badge}>
            <Shield className={styles.badgeMark} /> 보안 로그인 적용
          </span>
          <span className={styles.badge}>
            <Lock className={styles.badgeMark} /> 데이터 암호화 보호
          </span>
        </div> */}
      </div>

      <Modal
        open={helpModalOpen}
        onClose={() => setHelpModalOpen(false)}
        title="비밀번호 찾기"
        initialFocusRef={helpConfirmRef}
        describedBy={helpBodyId}
      >
        <div id={helpBodyId} className={styles.helpBody}>
          <p>현재 비밀번호 찾기 기능은 준비 중입니다.</p>
          <p>비밀번호 재설정이 필요하신 경우 고객센터로 문의해 주세요.</p>
        </div>
        <div className={styles.modalActions}>
          <button
            type="button"
            ref={helpConfirmRef}
            className={styles.btnPrimary}
            onClick={() => setHelpModalOpen(false)}
          >
            확인
          </button>
        </div>
      </Modal>
    </div>
  )
}
