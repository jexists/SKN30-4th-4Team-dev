import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Check, Contactless, HelpCircle, Lock, Shield } from '../../components/icons'
import { showToast } from '../../components/Toast/toastStore'
import styles from './AddCard.module.scss'

const GROUP_COUNT = 4

function onlyDigits(value: string, max: number) {
  return value.replace(/\D/g, '').slice(0, max)
}

export function AddCard() {
  const navigate = useNavigate()

  const [nickname, setNickname] = useState('')
  const [numbers, setNumbers] = useState(['', '', '', ''])
  const [expiry, setExpiry] = useState('')
  const [cvv, setCvv] = useState('')
  const [pwd, setPwd] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const numRefs = useRef<(HTMLInputElement | null)[]>([])

  function handleNumberChange(index: number, value: string) {
    const digits = onlyDigits(value, 4)
    setNumbers((prev) => prev.map((n, i) => (i === index ? digits : n)))
    if (digits.length === 4 && index < GROUP_COUNT - 1) {
      numRefs.current[index + 1]?.focus()
    }
  }

  function handleExpiryChange(value: string) {
    const digits = onlyDigits(value, 4)
    setExpiry(digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agreed) {
      showToast('결제 서비스 이용약관에 동의해주세요.', 'error')
      return
    }
    setSubmitting(true)
    window.setTimeout(() => {
      showToast('카드가 안전하게 등록되었습니다.', 'success')
      void navigate('/account')
    }, 1200)
  }

  const previewNumber = numbers.map((n) => (n ? n.padEnd(4, '•') : '••••')).join(' ')

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <h1 className={styles.title}>새 카드 등록하기</h1>
          <p className={styles.subtitle}>
            HomeShield의 안전한 결제 서비스를 이용하기 위해 카드 정보를 입력해주세요.
          </p>
        </header>

        <div className={styles.layout}>
          {/* 카드 미리보기 */}
          <div className={styles.previewCol}>
            <div className={styles.cardPreview}>
              <div className={styles.previewGlowA} aria-hidden />
              <div className={styles.previewGlowB} aria-hidden />
              <div className={styles.previewTop}>
                <div>
                  <span className={styles.previewLabel}>Payment Method</span>
                  <span className={styles.previewNickname}>{nickname || 'Main Card'}</span>
                </div>
                <Contactless className={styles.previewContactless} />
              </div>
              <div className={styles.previewBottom}>
                <div className={styles.previewNumber}>{previewNumber}</div>
                <div className={styles.previewFooter}>
                  <div>
                    <span className={styles.previewSmallLabel}>Expires</span>
                    <span className={styles.previewExpiry}>{expiry || 'MM/YY'}</span>
                  </div>
                  <div className={styles.previewChip} aria-hidden>
                    <div />
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.securityNote}>
              <Shield className={styles.securityIcon} />
              <p>
                입력하신 정보는 256비트 SSL 암호화 기술로 보호되며, HomeShield 서버에 직접 저장되지
                않고 결제 대행사를 통해 안전하게 관리됩니다.
              </p>
            </div>
          </div>

          {/* 입력 폼 */}
          <div className={styles.formCol}>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.field}>
                <label htmlFor="nickname">카드 별칭 (선택)</label>
                <input
                  id="nickname"
                  type="text"
                  maxLength={20}
                  placeholder="예: 메인 카드, 월세 결제용"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                />
              </div>

              <div className={styles.field}>
                <span className={styles.fieldLabel}>카드 번호</span>
                <div className={styles.numberGrid}>
                  {numbers.map((value, i) => (
                    <input
                      key={i}
                      ref={(el) => {
                        numRefs.current[i] = el
                      }}
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="0000"
                      className={styles.numberInput}
                      value={value}
                      onChange={(e) => handleNumberChange(i, e.target.value)}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label htmlFor="expiry">유효 기간 (MM/YY)</label>
                  <input
                    id="expiry"
                    type="text"
                    inputMode="numeric"
                    maxLength={7}
                    placeholder="MM / YY"
                    value={expiry}
                    onChange={(e) => handleExpiryChange(e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="cvv">CVV</label>
                  <div className={styles.inputWithIcon}>
                    <input
                      id="cvv"
                      type="password"
                      inputMode="numeric"
                      maxLength={3}
                      placeholder="3자리"
                      value={cvv}
                      onChange={(e) => setCvv(onlyDigits(e.target.value, 3))}
                    />
                    <span className={styles.helpIcon} title="카드 뒷면의 3자리 숫자">
                      <HelpCircle />
                    </span>
                  </div>
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="pwd">비밀번호 앞 2자리</label>
                <div className={styles.pwdRow}>
                  <input
                    id="pwd"
                    type="password"
                    inputMode="numeric"
                    maxLength={2}
                    placeholder="••"
                    className={styles.pwdInput}
                    value={pwd}
                    onChange={(e) => setPwd(onlyDigits(e.target.value, 2))}
                  />
                  <span className={styles.pwdMask}>••</span>
                </div>
              </div>

              <div className={styles.noticeBox}>
                <Lock className={styles.noticeIcon} />
                <span>입력하신 정보는 암호화되어 안전하게 보호됩니다.</span>
              </div>

              <label className={styles.agreeRow}>
                <span className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <Check className={styles.checkboxMark} />
                </span>
                <span>결제 서비스 이용약관 및 개인정보 수집 이용에 동의합니다.</span>
              </label>

              <div className={styles.actions}>
                <button type="submit" className={styles.submitBtn} disabled={submitting}>
                  {submitting ? '처리 중...' : '등록하기'}
                </button>
                <Link to="/account" className={styles.cancelBtn}>
                  취소
                </Link>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
