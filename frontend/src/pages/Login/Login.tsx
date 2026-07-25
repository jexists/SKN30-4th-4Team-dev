import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { Chat, Shield } from '../../components/icons'
import { showToast } from '../../components/Toast/toastStore'
import { keepSignedIn } from '../../config/authStorage'
import { BRAND } from '../../config/env'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './Login.module.scss'

const SOON = '아직 준비 중인 기능입니다.'

export function Login() {
  const { isAuthed, signIn } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation() as { state: { from?: string; expired?: boolean } | null }
  const from = state?.from ?? '/mypage'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // 직전 선택을 기억한다(기본 유지). 이 값은 로그인 시 세션 저장 위치를 결정한다.
  const [keep, setKeep] = useState(keepSignedIn.get())
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!supabase) {
      showToast('로그인 서비스가 아직 설정되지 않았습니다. (VITE_SUPABASE_* 환경변수 필요)', 'error')
      return
    }
    if (!email || !password) {
      showToast('이메일과 비밀번호를 입력해주세요.', 'error')
      return
    }

    setSubmitting(true)
    // storage 어댑터가 이 값을 보고 저장 위치를 고르므로 로그인 호출 전에 기록한다.
    keepSignedIn.set(keep)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      showToast('이메일 또는 비밀번호가 올바르지 않습니다.', 'error')
      setSubmitting(false)
      return
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
                  checked={keep}
                  onChange={(e) => setKeep(e.target.checked)}
                />
                <span>로그인 상태 유지</span>
              </label>
              <button
                type="button"
                className={styles.textLink}
                onClick={() => showToast(`비밀번호 찾기는 ${SOON}`, 'info')}
              >
                비밀번호 찾기
              </button>
            </div>

            <button type="submit" className={styles.submit} disabled={submitting}>
              {submitting ? '로그인 중…' : '로그인'}
            </button>
          </form>

          <div className={styles.divider}>
            <span>또는 SNS로 시작하기</span>
          </div>

          <div className={styles.socials}>
            <button
              type="button"
              className={`${styles.social} ${styles.kakao}`}
              onClick={() => showToast(`카카오 로그인은 ${SOON}`, 'info')}
            >
              <Chat className={styles.socialMark} />
              카카오로 로그인
            </button>
            <button
              type="button"
              className={`${styles.social} ${styles.naver}`}
              onClick={() => showToast(`네이버 로그인은 ${SOON}`, 'info')}
            >
              <span className={styles.naverMark}>N</span>
              네이버로 로그인
            </button>
          </div>

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
    </div>
  )
}
