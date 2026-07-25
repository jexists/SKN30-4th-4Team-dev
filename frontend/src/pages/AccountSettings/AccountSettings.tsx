import { useState } from 'react'
import { Link } from 'react-router-dom'

import { AddCircle, Check, Edit, Lock, LogOut, Shield, User } from '../../components/icons'
import { useAuth } from '../../hooks/useAuth'
import styles from './AccountSettings.module.scss'

type Plan = {
  id: string
  name: string
  price: string
  features: string[]
}

const PLANS: Plan[] = [
  {
    id: 'basic',
    name: '베이직',
    price: '₩0',
    features: ['월 2회 OCR 문서 분석', '기본 AI 법률 Q&A (제한됨)', '기본 위험 보고서 생성'],
  },
  {
    id: 'premium',
    name: '프리미엄',
    price: '₩14,900',
    features: [
      '월 20회 OCR 문서 분석',
      '무제한 RAG 기반 정밀 법률 챗봇',
      '심층 계약 분석 보고서 PDF 제공',
      '전세가율 및 주변 시세 변동 알림',
    ],
  },
]

const CURRENT_PLAN_ID = 'premium'

const PAYMENT_HISTORY = [
  { date: '2024.11.24', label: '프리미엄 플랜 (정기결제)', amount: '₩19,900' },
  { date: '2024.10.24', label: '프리미엄 플랜 (정기결제)', amount: '₩19,900' },
  { date: '2024.09.24', label: '베이직 → 프리미엄 변경', amount: '₩9,900' },
]

export function AccountSettings() {
  const { signOut } = useAuth()

  const [twoFactor, setTwoFactor] = useState(true)
  const [notifyReport, setNotifyReport] = useState(true)
  const [notifyChat, setNotifyChat] = useState(false)

  function handleSignOut() {
    signOut()
    // 보호된 화면(RequireAuth)에서 로그아웃하면 SPA 내 navigate('/') 는 라우터가
    // 위치를 갱신하기 전에 가드가 먼저 인증 해제를 감지해 /login 으로 보내버리는
    // 경합이 생긴다. 전체 새로고침으로 이동하면 앱이 처음부터 다시 마운트되며
    // 이미 지워진 토큰으로 시작하므로 이 경합 자체가 발생하지 않는다.
    window.location.href = '/'
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <h1 className={styles.title}>계정 관리</h1>
          <p className={styles.subtitle}>개인 정보, 구독 플랜 및 보안 설정을 한곳에서 관리하세요.</p>
        </header>

        {/* 1. 프로필 및 계정 정보 */}
        <section className={styles.card}>
          <div className={styles.profileRow}>
            <div className={styles.avatarWrap}>
              <div className={styles.avatar}>
                <User className={styles.avatarIcon} />
              </div>
              <button type="button" className={styles.avatarEdit} aria-label="프로필 사진 변경">
                <Edit />
              </button>
            </div>
            <div>
              <h2 className={styles.name}>김철수</h2>
              <p className={styles.memberTier}>프리미엄 회원</p>
            </div>
          </div>
          <div className={styles.infoList}>
            <div className={styles.infoRow}>
              <div>
                <p className={styles.infoLabel}>이메일 주소</p>
                <p className={styles.infoValue}>chulsoo.kim@example.com</p>
              </div>
              <button type="button" className={styles.linkBtn}>
                수정
              </button>
            </div>
            <div className={styles.infoRow}>
              <div>
                <p className={styles.infoLabel}>휴대폰 번호</p>
                <p className={styles.infoValue}>010-1234-5678</p>
              </div>
              <button type="button" className={styles.linkBtn}>
                수정
              </button>
            </div>
          </div>
        </section>

        {/* 2. 구독 플랜 */}
        <section className={styles.planGrid}>
          {PLANS.map((plan) => {
            const isCurrent = plan.id === CURRENT_PLAN_ID
            return (
              <div
                key={plan.id}
                className={isCurrent ? `${styles.planCard} ${styles.planCurrent}` : styles.planCard}
              >
                {isCurrent && <span className={styles.planBadge}>현재 플랜</span>}
                <div className={styles.planHead}>
                  <h3 className={styles.planName}>{plan.name}</h3>
                  <div className={styles.planPrice}>
                    <span>{plan.price}</span>
                    <span className={styles.planPriceUnit}>/ 월</span>
                  </div>
                </div>
                <ul className={styles.planFeatures}>
                  {plan.features.map((f) => (
                    <li key={f}>
                      <Check className={styles.planFeatureIcon} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button type="button" className={styles.planBtnCurrent} disabled>
                    현재 사용 중
                  </button>
                ) : (
                  <button type="button" className={styles.planBtnSelect}>
                    플랜 선택하기
                  </button>
                )}
              </div>
            )
          })}
        </section>

        {/* 3. 결제 수단 */}
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>결제 수단 관리</h3>
          <div className={styles.cardBody}>
            <div className={styles.paymentRow}>
              <div className={styles.paymentInfo}>
                <div className={styles.cardBrand}>SHINHAN</div>
                <div>
                  <p className={styles.paymentName}>신한카드 (4211)</p>
                  <p className={styles.paymentSub}>기본 결제 수단</p>
                </div>
              </div>
              <button type="button" className={styles.dangerBtn}>
                삭제
              </button>
            </div>
            <Link to="/account/cards/new" className={styles.addCardBtn}>
              <AddCircle /> 새 카드 등록하기
            </Link>
          </div>
        </section>

        {/* 4. 보안 및 알림 설정 */}
        <section className={styles.card}>
          <div className={styles.cardBody}>
            <h3 className={styles.cardTitle}>보안 설정</h3>
            <div className={styles.settingRow}>
              <div className={styles.settingLeft}>
                <Lock className={styles.settingIcon} />
                <div>
                  <p className={styles.settingLabel}>비밀번호 변경</p>
                  <p className={styles.settingSub}>마지막 변경: 3개월 전</p>
                </div>
              </div>
              <button type="button" className={styles.linkBtn}>
                변경
              </button>
            </div>
            <div className={styles.settingRow}>
              <div className={styles.settingLeft}>
                <Shield className={styles.settingIcon} />
                <div>
                  <p className={styles.settingLabel}>2단계 인증 (2FA)</p>
                  <p className={styles.settingSub}>로그인 시 추가 보안 확인</p>
                </div>
              </div>
              <Toggle checked={twoFactor} onChange={setTwoFactor} label="2단계 인증" />
            </div>
          </div>

          <div className={styles.cardBody}>
            <h3 className={styles.cardTitle}>알림 설정</h3>
            <div className={styles.settingRow}>
              <div>
                <p className={styles.settingLabel}>위험 보고서 생성 완료</p>
                <p className={styles.settingSub}>분석 완료 시 즉시 알림</p>
              </div>
              <Toggle checked={notifyReport} onChange={setNotifyReport} label="위험 보고서 알림" />
            </div>
            <div className={styles.settingRow}>
              <div>
                <p className={styles.settingLabel}>AI 챗봇 상담 내역 업데이트</p>
                <p className={styles.settingSub}>중요한 상담 정보 자동 알림</p>
              </div>
              <Toggle checked={notifyChat} onChange={setNotifyChat} label="AI 챗봇 알림" />
            </div>
          </div>
        </section>

        {/* 5. 결제 내역 */}
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <h3 className={styles.cardTitle}>결제 내역</h3>
            <button type="button" className={styles.linkBtn}>
              전체 보기
            </button>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>플랜명</th>
                  <th className={styles.amountCol}>금액</th>
                </tr>
              </thead>
              <tbody>
                {PAYMENT_HISTORY.map((row) => (
                  <tr key={row.date + row.label}>
                    <td>{row.date}</td>
                    <td>{row.label}</td>
                    <td className={styles.amountCol}>{row.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className={styles.signOutRow}>
          <button type="button" className={styles.signOutBtn} onClick={handleSignOut}>
            <LogOut /> 로그아웃
          </button>
        </div>
      </div>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={checked ? `${styles.toggle} ${styles.toggleOn}` : styles.toggle}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleThumb} />
    </button>
  )
}
