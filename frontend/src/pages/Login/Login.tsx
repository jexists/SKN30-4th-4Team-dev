import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'

import { Chat, Shield } from '../../components/icons'
import { BRAND } from '../../config/env'
import { supabase } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'
import styles from './Login.module.scss'

const SOON = '아직 준비 중인 기능입니다.'

export function Login() {
  const { isAuthed, signIn } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation() as { state: { from?: string } | null }
  const from = state?.from ?? '/mypage'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setNotice(null)

    if (!supabase) {
      setNotice('로그인 서비스가 아직 설정되지 않았습니다. (VITE_SUPABASE_* 환경변수 필요)')
      return
    }
    if (!email || !password) {
      setNotice('이메일과 비밀번호를 입력해주세요.')
      return
    }

    setSubmitting(true)
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      setNotice('이메일 또는 비밀번호가 올바르지 않습니다.')
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

          {/* {state?.from && (
            <p className={styles.redirectNote} role="status">
              로그인이 필요한 화면입니다. 로그인하면 <strong>{state.from}</strong> 으로 이동합니다.
            </p>
          )} */}

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
                  checked={keepSignedIn}
                  onChange={(e) => setKeepSignedIn(e.target.checked)}
                />
                <span>로그인 상태 유지</span>
              </label>
              <button
                type="button"
                className={styles.textLink}
                onClick={() => setNotice(`비밀번호 찾기는 ${SOON}`)}
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
              onClick={() => setNotice(`카카오 로그인은 ${SOON}`)}
            >
              <Chat className={styles.socialMark} />
              카카오로 로그인
            </button>
            <button
              type="button"
              className={`${styles.social} ${styles.naver}`}
              onClick={() => setNotice(`네이버 로그인은 ${SOON}`)}
            >
              <span className={styles.naverMark}>N</span>
              네이버로 로그인
            </button>
          </div>

          {notice && (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          )}

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
