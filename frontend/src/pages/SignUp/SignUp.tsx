import { useEffect, useId, useRef, useState } from 'react'
import { Link, Navigate, useBlocker, useLocation, useNavigate } from 'react-router-dom'

import { abandonKakaoSignup, completeKakaoSignup } from '../../api/kakaoAuth'
import { consumeKakaoReturnTo, startKakaoOAuth } from '../../auth/kakaoOAuth'
import { Chat, Check, ChevronRight, Mail, Shield } from '../../components/icons'
import { LegalDocView } from '../../components/LegalDoc/LegalDoc'
import { Modal } from '../../components/Modal/Modal'
import { showToast } from '../../components/Toast/toastStore'
import { BRAND } from '../../config/env'
import { supabase } from '../../config/supabase'
import { PRIVACY, TERMS } from '../../content/legal'
import { useAuth } from '../../hooks/useAuth'
import styles from './SignUp.module.scss'

/** 약관 동의값. "전체 동의" 는 따로 저장하지 않고 이 셋에서 파생시킨다(두 값이 어긋날 수 없다). */
type Agreements = { terms: boolean; privacy: boolean; marketing: boolean }
const NO_AGREEMENTS: Agreements = { terms: false, privacy: false, marketing: false }

/**
 * 카카오 가입은 OAuth 리다이렉트로 화면을 완전히 떠났다가 `?mode=kakao` 로 돌아온다.
 * 그 사이 React state 는 사라지므로, 떠나기 직전 값을 sessionStorage 에 담아 두고 돌아왔을 때
 * 되살린다 — 약관을 체크하고 카카오를 눌렀는데 돌아와 보니 다 풀려 있는 걸 막는다.
 * 이메일·비밀번호는 카카오 가입에 쓰이지 않고 민감하므로 담지 않는다.
 */
const DRAFT_KEY = 'homeshield.signupDraft'
type Draft = { nickname: string; agreements: Agreements }

function saveDraft(draft: Draft): void {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // 저장에 실패해도 가입 자체는 진행된다 — 돌아온 뒤 다시 입력하면 된다.
  }
}

/** 저장된 값을 읽기만 한다(지우지 않음) — StrictMode 가 초기화 함수를 두 번 불러도 안전하다. */
function readDraft(): Draft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Draft> | null
    if (!parsed || typeof parsed !== 'object') return null
    const agreements = parsed.agreements
    return {
      nickname: typeof parsed.nickname === 'string' ? parsed.nickname : '',
      agreements: {
        terms: agreements?.terms === true,
        privacy: agreements?.privacy === true,
        marketing: agreements?.marketing === true,
      },
    }
  } catch {
    // 남의 코드가 같은 키를 덮어썼거나 JSON 이 깨졌으면 그냥 빈 상태로 시작한다.
    return null
  }
}

function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // 못 지워도 다음 가입 시작 시 덮어써진다.
  }
}

/**
 * Supabase Auth 오류를 사용자에게 보여줄 한국어로 바꾼다.
 *
 * signUp 은 백엔드를 거치지 않고 프론트가 직접 부르는 유일한 경로라, 봉투(`message`)를
 * 서버가 소유하는 다른 API 와 달리 문구를 여기서 가진다. 원문을 그대로 띄우면
 * "User already registered" 같은 영어가 사용자에게 노출된다.
 *
 * code 는 최신 supabase-js 만 채워 주므로 message 매칭도 함께 둔다.
 */
function signUpErrorMessage(error: { code?: string; message: string }): string {
  const code = error.code ?? ''
  const message = error.message.toLowerCase()

  if (code === 'user_already_exists' || message.includes('already registered')) {
    return '이미 가입된 이메일입니다. 로그인해 주세요.'
  }
  if (code === 'email_address_invalid' || message.includes('unable to validate email')) {
    return '올바른 이메일 주소를 입력해 주세요.'
  }
  if (code === 'weak_password' || message.includes('password should be')) {
    return '비밀번호가 너무 단순합니다. 조금 더 복잡하게 입력해 주세요.'
  }
  if (code.includes('rate_limit') || message.includes('for security purposes')) {
    return '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.'
  }
  // 모르는 오류까지 영어로 흘리지 않는다. 원인 추적은 콘솔에 남긴다.
  console.error('[signUp] 처리하지 못한 오류', error)
  return '회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

export function SignUp() {
  const { isAuthed, signIn, signOut } = useAuth()
  const navigate = useNavigate()
  const { search } = useLocation()
  // 카카오는 OAuth 를 거쳐야 하므로 "선택" 이 URL 로 돌아온다. 이메일은 화면 안 상태다.
  const isKakao = new URLSearchParams(search).get('mode') === 'kakao'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [nickname, setNickname] = useState(() => (isKakao ? (readDraft()?.nickname ?? '') : ''))
  const [agreements, setAgreements] = useState<Agreements>(
    () => (isKakao ? readDraft()?.agreements : null) ?? NO_AGREEMENTS,
  )
  const [emailOpen, setEmailOpen] = useState(false)
  const [openDoc, setOpenDoc] = useState<'terms' | 'privacy' | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const signupCompleted = useRef(false)
  const abandonmentStarted = useRef(false)
  const allAgreeRef = useRef<HTMLInputElement>(null)
  const emailFieldsId = useId()

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isKakao &&
      !signupCompleted.current &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  )

  useEffect(() => {
    if (blocker.state !== 'blocked' || abandonmentStarted.current) return

    abandonmentStarted.current = true
    setSubmitting(true)
    void abandonKakaoSignup()
      .then(() => {
        signupCompleted.current = true
        clearDraft()
        signOut()
        blocker.proceed()
        // 예전에는 이 경로가 항상 다른 화면으로 나가는 길이라 언마운트로 사라졌지만,
        // "이메일로 회원가입하기" 는 같은 라우트(?mode=kakao 만 해제)로 남는다.
        // 되돌리지 않으면 버튼이 "가입 중…" 으로 굳어 아무것도 눌리지 않는다.
        setSubmitting(false)
      })
      .catch(() => {
        abandonmentStarted.current = false
        setSubmitting(false)
        blocker.reset()
      })
  }, [blocker, signOut])

  const pwValid = password.length >= 8
  const pwMatch = confirm.length > 0 && password === confirm
  const requiredAgreed = agreements.terms && agreements.privacy
  const allAgreed = requiredAgreed && agreements.marketing
  const someAgreed = agreements.terms || agreements.privacy || agreements.marketing
  // 가입 방식이 정해지기 전에는 입력 영역도 제출 버튼도 없다(약관만 미리 보여준다).
  const method = isKakao ? 'kakao' : emailOpen ? 'email' : null

  // 일부만 동의한 상태는 체크도 해제도 아니다 — 네이티브 indeterminate 로 표시한다.
  useEffect(() => {
    if (allAgreeRef.current) allAgreeRef.current.indeterminate = someAgreed && !allAgreed
  }, [someAgreed, allAgreed])

  function setAgreement(key: keyof Agreements, checked: boolean) {
    setAgreements((prev) => ({ ...prev, [key]: checked }))
  }

  async function handleKakaoStart() {
    // 리다이렉트로 화면을 떠나기 직전에 담아 둔다 — 돌아오면 되살린다.
    saveDraft({ nickname, agreements })
    setSubmitting(true)
    try {
      await startKakaoOAuth('/mypage', 'signup')
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '카카오 회원가입을 시작하지 못했습니다. 다시 시도해 주세요.'
      showToast(message, 'error')
      setSubmitting(false)
    }
  }

  /**
   * 카카오로 인증까지 마친 뒤 이메일 가입으로 바꾸는 경우. 이 시점에는 약관 동의 전의
   * 임시 카카오 계정이 남아 있으므로, 그냥 폼만 바꾸면 유령 계정이 된다. `?mode=kakao` 를
   * 떠나는 이동으로 만들어 위 blocker 가 임시 계정 삭제·로그아웃까지 처리하게 한다.
   */
  function handleSwitchToEmail() {
    // 폼을 펼친 채로 두지 않고 처음 화면(방식 미선택)으로 되돌린다 — 카카오 가입이
    // 취소됐다는 게 드러나고, 어떤 방식으로 갈지 사용자가 다시 고르게 된다.
    setEmailOpen(false)
    void navigate('/signup', { replace: true })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()

    if (isKakao) {
      if (!nickname.trim()) {
        showToast('닉네임을 입력해주세요.', 'error')
        return
      }
      if (!requiredAgreed) {
        showToast('필수 약관에 동의해주세요.', 'error')
        return
      }

      setSubmitting(true)
      try {
        await completeKakaoSignup({
          nickname: nickname.trim(),
          agree_terms: true,
          agree_privacy: true,
          agree_marketing: agreements.marketing,
        })
        signupCompleted.current = true
        clearDraft()
        setDone(true)
        void navigate(consumeKakaoReturnTo(), { replace: true })
      } catch {
        setSubmitting(false)
      }
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('올바른 이메일 주소를 입력해주세요.', 'error')
      return
    }
    if (!nickname.trim()) {
      showToast('닉네임을 입력해주세요.', 'error')
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
    if (!requiredAgreed) {
      showToast('필수 약관에 동의해주세요.', 'error')
      return
    }
    if (!supabase) {
      showToast(
        '회원가입 서비스가 아직 설정되지 않았습니다. (VITE_SUPABASE_* 환경변수 필요)',
        'error',
      )
      return
    }

    setSubmitting(true)
    // Supabase Auth 로 가입. nickname·마케팅 동의는 metadata 로 전달 →
    // DB 트리거(handle_new_user)가 app_user·profile·user_agreement·가입 축하 알림을 만든다.
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nickname: nickname.trim(), agree_marketing: agreements.marketing } },
    })

    if (signUpError) {
      showToast(signUpErrorMessage(signUpError), 'error')
      setSubmitting(false)
      return
    }

    clearDraft()
    setDone(true)

    if (data.session) {
      // 이메일 인증이 꺼져 있으면 세션이 바로 생긴다 → 자동 로그인 후 홈으로.
      signIn(data.session.access_token)
      showToast('가입이 완료되었습니다. 잠시 후 홈 화면으로 이동합니다.', 'success')
      setTimeout(() => void navigate('/', { replace: true }), 1800)
    } else {
      // 이메일 인증 등으로 세션이 없으면 자동 로그인 불가 → 로그인 화면으로.
      // from='/' 를 실어 보내 로그인 성공 시 홈으로 이동하게 한다.
      showToast(
        '가입이 완료되었습니다. 이메일 인증 후 로그인해 주세요. 잠시 후 로그인 화면으로 이동합니다.',
        'success',
      )
      setTimeout(() => void navigate('/login', { replace: true, state: { from: '/' } }), 1800)
    }
  }

  // 이미 로그인한 상태라면 폼을 보여주지 않는다.
  if (isAuthed && !isKakao) return <Navigate to="/mypage" replace />

  return (
    <div className={styles.page}>
      <div className={styles.body}>
        <div className={styles.card}>
          {isKakao ? (
            /* 카카오 인증을 마치고 돌아온 상태. 처음 화면으로 되돌아온 것처럼 보이면
               인증이 됐는지·뭘 더 해야 하는지 알 수 없으므로, 방식 선택 버튼을 걷어내고
               "남은 단계" 임이 드러나는 화면으로 바꾼다. */
            <div className={styles.kakaoStep}>
              <span className={styles.kakaoBadge}>
                <Chat className={styles.kakaoBadgeMark} />
              </span>
              <h1 className={styles.title}>카카오 계정으로 회원가입</h1>
              <p className={styles.subtitle}>회원가입을 완료하기 위해 추가 정보를 입력해주세요.</p>
            </div>
          ) : (
            <>
              <div className={styles.brandAnchor}>
                <span className={styles.brandBadge}>
                  <Shield className={styles.brandMark} />
                </span>
                <h1 className={styles.title}>{BRAND.nameKo} 회원가입</h1>
                <p className={styles.subtitle}>안전한 전세 계약, 지금 시작하세요.</p>
              </div>

              {/* 가입 방식 선택 — 카카오가 기본, 이메일이 보조다. */}
              <div className={styles.methods}>
                <button
                  type="button"
                  /* 이메일을 고른 동안에는 카카오 노랑을 죽여 "고르지 않은 쪽" 으로
                     물러나게 한다. 그대로 두면 여전히 주 동작처럼 보인다. */
                  className={`${styles.method} ${styles.kakao} ${emailOpen ? styles.dimmed : ''}`}
                  onClick={() => void handleKakaoStart()}
                  disabled={submitting || done}
                >
                  <Chat className={styles.methodMark} />
                  카카오로 시작하기
                </button>
                <button
                  type="button"
                  className={`${styles.method} ${styles.emailMethod}`}
                  onClick={() => setEmailOpen((open) => !open)}
                  disabled={submitting || done}
                  aria-pressed={emailOpen}
                  aria-expanded={emailOpen}
                  aria-controls={emailFieldsId}
                >
                  <Mail className={styles.methodMark} />
                  이메일로 시작하기
                  {emailOpen && <Check className={styles.methodCheck} aria-hidden="true" />}
                </button>
              </div>
            </>
          )}

          <div className={styles.first_rule} />

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            {/* 입력 영역만 바뀐다 — 화면 이동 없음. 닫혀 있을 땐 아예 렌더하지 않아
                숨은 입력이 탭 순서에 남지 않는다(값은 state 에 남아 다시 열면 복원된다). */}
            {method !== null && (
              <div className={styles.fields} id={isKakao ? undefined : emailFieldsId}>
                {method === 'email' && (
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
                )}

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="nickname">
                    닉네임
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

                {method === 'email' && (
                  <>
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
                        <span className={`${styles.hint} ${styles.bad}`}>
                          8자 이상이어야 합니다.
                        </span>
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
                  </>
                )}
              </div>
            )}

            {method !== null && <div className={styles.rule} />}

            {/* 약관은 가입 방식과 무관하게 처음부터 늘 보인다. */}
            <div className={styles.agreements}>
              <label className={`${styles.agree} ${styles.agreeAll}`}>
                <input
                  ref={allAgreeRef}
                  type="checkbox"
                  checked={allAgreed}
                  onChange={(e) =>
                    setAgreements({
                      terms: e.target.checked,
                      privacy: e.target.checked,
                      marketing: e.target.checked,
                    })
                  }
                />
                <span>전체 동의</span>
              </label>

              <div className={styles.agreeDivider} />

              <div className={styles.agreeRow}>
                <label className={styles.agree}>
                  <input
                    type="checkbox"
                    checked={agreements.terms}
                    onChange={(e) => setAgreement('terms', e.target.checked)}
                  />
                  <span>
                    <b className={styles.req}>(필수)</b> 이용약관
                  </span>
                </label>
                <button
                  type="button"
                  className={styles.legalLink}
                  onClick={() => setOpenDoc('terms')}
                >
                  보기
                  <ChevronRight className={styles.legalMark} />
                </button>
              </div>

              <div className={styles.agreeRow}>
                <label className={styles.agree}>
                  <input
                    type="checkbox"
                    checked={agreements.privacy}
                    onChange={(e) => setAgreement('privacy', e.target.checked)}
                  />
                  <span>
                    <b className={styles.req}>(필수)</b> 개인정보 처리방침
                  </span>
                </label>
                <button
                  type="button"
                  className={styles.legalLink}
                  onClick={() => setOpenDoc('privacy')}
                >
                  보기
                  <ChevronRight className={styles.legalMark} />
                </button>
              </div>

              <div className={styles.agreeRow}>
                <label className={styles.agree}>
                  <input
                    type="checkbox"
                    checked={agreements.marketing}
                    onChange={(e) => setAgreement('marketing', e.target.checked)}
                  />
                  <span>
                    <b className={styles.opt}>(선택)</b> 마케팅 정보 수신
                  </span>
                </label>
              </div>
            </div>

            {method !== null && (
              <button type="submit" className={styles.submit} disabled={submitting || done}>
                {done
                  ? '가입 완료 ✓'
                  : submitting
                    ? '가입 중…'
                    : isKakao
                      ? '가입 완료'
                      : '회원가입'}
              </button>
            )}
          </form>

          {isKakao ? (
            <>
              <div className={styles.first_rule} />
              <div className={styles.switchBlock}>
                <button
                  type="button"
                  className={styles.switchLink}
                  onClick={handleSwitchToEmail}
                  disabled={submitting || done}
                >
                  이메일로 회원가입하기
                </button>
                {/* 되돌릴 수 없는 전환이라 미리 알린다 — 약관 동의 전의 임시 카카오
                    계정을 지우고 로그아웃한 뒤 이메일 가입으로 넘어간다. */}
                <p className={styles.switchNote}>진행 중인 카카오 회원가입은 취소됩니다.</p>
              </div>
            </>
          ) : (
            <p className={styles.signin}>
              이미 회원이신가요?
              <Link to="/login">로그인</Link>
            </p>
          )}
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
