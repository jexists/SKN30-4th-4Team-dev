import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'

import { Chat, Shield } from '../../components/icons'
import { LegalDocView } from '../../components/LegalDoc/LegalDoc'
import { Modal } from '../../components/Modal/Modal'
import { showToast } from '../../components/Toast/toastStore'
import { BRAND } from '../../config/env'
import { supabase } from '../../config/supabase'
import { PRIVACY, TERMS } from '../../content/legal'
import { useAuth } from '../../hooks/useAuth'
import styles from './SignUp.module.scss'

const SOON = '아직 준비 중인 기능입니다.'

export function SignUp() {
  const { isAuthed, signIn } = useAuth()
  const navigate = useNavigate()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [nickname, setNickname] = useState('')
  const [agreeRequired, setAgreeRequired] = useState(false)
  const [agreeMarketing, setAgreeMarketing] = useState(false)
  const [openDoc, setOpenDoc] = useState<'terms' | 'privacy' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const pwValid = password.length >= 8
  const pwMatch = confirm.length > 0 && password === confirm

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('올바른 이메일 주소를 입력해주세요.', 'error')
      return
    }
    if (!pwValid) {
      showToast('비밀번호는 8자 이상이어야 합니다.', 'error')
      return
    }
    if (!pwMatch) {
      showToast('비밀번호가 일치하지 않습니다.', 'error')
      return
    }
    if (!agreeRequired) {
      showToast('필수 약관에 동의해주세요.', 'error')
      return
    }
    if (!supabase) {
      showToast('회원가입 서비스가 아직 설정되지 않았습니다. (VITE_SUPABASE_* 환경변수 필요)', 'error')
      return
    }

    setSubmitting(true)
    // Supabase Auth 로 가입. nickname·마케팅 동의는 metadata 로 전달 →
    // DB 트리거(handle_new_user)가 app_user·profile·user_agreement 를 자동 생성한다.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nickname: nickname.trim() || null, agree_marketing: agreeMarketing } },
    })

    if (signUpError) {
      showToast(signUpError.message, 'error')
      setSubmitting(false)
      return
    }

    // 이메일 인증이 꺼져 있으면 세션이 바로 생긴다 → 로그인 상태로 홈에 진입.
    if (data.session) signIn(data.session.access_token)

    setDone(true)
    showToast(
      data.session
        ? '가입이 완료되었습니다. 잠시 후 홈 화면으로 이동합니다.'
        : '가입이 완료되었습니다. 이메일 인증 후 로그인해 주세요. 잠시 후 홈 화면으로 이동합니다.',
      'success',
    )
    // 안내를 잠시 보여준 뒤 홈으로 이동.
    setTimeout(() => void navigate('/', { replace: true }), 1800)
  }

  // 이미 로그인한 상태라면 폼을 보여주지 않는다.
  if (isAuthed) return <Navigate to="/mypage" replace />

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <div className={styles.card}>
          <div className={styles.brandAnchor}>
            <span className={styles.brandBadge}>
              <Shield className={styles.brandMark} />
            </span>
            <h1 className={styles.title}>{BRAND.nameKo} 회원가입</h1>
            <p className={styles.subtitle}>안전한 전세 계약, 지금 시작하세요.</p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
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
              <label className={styles.label} htmlFor="nickname">
                닉네임 <span className={styles.optional}>(선택)</span>
              </label>
              <input
                id="nickname"
                type="text"
                className={styles.input}
                placeholder="서비스에서 표시될 이름"
                autoComplete="nickname"
                maxLength={20}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
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
                placeholder="8자 이상 입력하세요"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {password.length > 0 && !pwValid && (
                <span className={`${styles.hint} ${styles.bad}`}>8자 이상이어야 합니다.</span>
              )}
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="confirm">
                비밀번호 확인
              </label>
              <input
                id="confirm"
                type="password"
                className={styles.input}
                placeholder="비밀번호를 다시 입력하세요"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {confirm.length > 0 && (
                <span className={`${styles.hint} ${pwMatch ? styles.ok : styles.bad}`}>
                  {pwMatch ? '비밀번호가 일치합니다.' : '비밀번호가 일치하지 않습니다.'}
                </span>
              )}
            </div>

            <div className={styles.agreements}>
              {/* 약관 링크는 버튼이라 label 안에 두지 않고 형제로 배치한다. 체크박스는 htmlFor 로 연결. */}
              <div className={styles.agree}>
                <input
                  type="checkbox"
                  id="agree-required"
                  checked={agreeRequired}
                  onChange={(e) => setAgreeRequired(e.target.checked)}
                />
                <span>
                  <label htmlFor="agree-required">
                    <b className={styles.req}>[필수]</b>
                  </label>{' '}
                  <button
                    type="button"
                    className={styles.legalLink}
                    onClick={() => setOpenDoc('terms')}
                  >
                    이용약관
                  </button>{' '}
                  및{' '}
                  <button
                    type="button"
                    className={styles.legalLink}
                    onClick={() => setOpenDoc('privacy')}
                  >
                    개인정보처리방침
                  </button>
                  <label htmlFor="agree-required">에 동의합니다.</label>
                </span>
              </div>
              <label className={styles.agree}>
                <input
                  type="checkbox"
                  checked={agreeMarketing}
                  onChange={(e) => setAgreeMarketing(e.target.checked)}
                />
                <span>
                  <b className={styles.opt}>[선택]</b> 마케팅 정보 수신에 동의합니다.
                </span>
              </label>
            </div>

            <button type="submit" className={styles.submit} disabled={submitting || done}>
              {done ? '가입 완료 ✓' : submitting ? '가입 중…' : '회원가입'}
            </button>
          </form>

          <div className={styles.divider}>
            <span>또는 SNS로 시작하기</span>
          </div>

          <div className={styles.socials}>
            <button
              type="button"
              className={`${styles.social} ${styles.kakao}`}
              onClick={() => showToast(`카카오 회원가입은 ${SOON}`, 'info')}
            >
              <Chat className={styles.socialMark} />
              카카오로 시작하기
            </button>
            <button
              type="button"
              className={`${styles.social} ${styles.naver}`}
              onClick={() => showToast(`네이버 회원가입은 ${SOON}`, 'info')}
            >
              <span className={styles.naverMark}>N</span>
              네이버로 시작하기
            </button>
          </div>

          <p className={styles.signin}>
            이미 회원이신가요?
            <Link to="/login">로그인</Link>
          </p>
        </div>
      </div>

      <Modal
        open={openDoc !== null}
        onClose={() => setOpenDoc(null)}
        title={openDoc === 'privacy' ? PRIVACY.title : TERMS.title}
      >
        <LegalDocView doc={openDoc === 'privacy' ? PRIVACY : TERMS} />
      </Modal>
    </div>
  )
}
