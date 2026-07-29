import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Modal } from '../../components/Modal/Modal'
import { showToast } from '../../components/Toast/toastStore'
import {
  ArrowRight,
  BarChart,
  Chat,
  Check,
  Edit,
  FileLines,
  Lock,
  LogOut,
  User,
} from '../../components/icons'
import { useAuth } from '../../hooks/useAuth'
import { setAvatarFile, useAvatarUrl } from '../../hooks/useAvatar'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { setReportAlertsEnabled, useReportAlertsEnabled } from '../../hooks/useNotifications'
import styles from './MyPage.module.scss'

// 백엔드에 저장 API가 아직 없어, "다시 바꾸기 전까지 유지"는 localStorage 로 흉내낸다.
const PHONE_STORAGE_KEY = 'homeshield.phone'
const PASSWORD_CHANGED_STORAGE_KEY = 'homeshield.passwordChangedAt'
const DEFAULT_PHONE = '010-1234-5678'

function readStoredPhone(): string {
  try {
    return window.localStorage.getItem(PHONE_STORAGE_KEY) || DEFAULT_PHONE
  } catch {
    return DEFAULT_PHONE
  }
}

function readPasswordChanged(): boolean {
  try {
    return window.localStorage.getItem(PASSWORD_CHANGED_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

type RiskLevel = 'safe' | 'caution' | 'risk'

type HistoryItem = {
  id: string
  address: string
  date: string
  level: RiskLevel
}

type Consultation = {
  id: string
  label: string
  timeAgo: string
  title: string
  excerpt: string
}

const HISTORY: HistoryItem[] = [
  { id: '1', address: '서울시 강남구 테헤란로 123-45', date: '2026.05.20 14:30', level: 'safe' },
  {
    id: '2',
    address: '경기도 성남시 분당구 판교역로 10',
    date: '2026.05.18 10:15',
    level: 'caution',
  },
  { id: '3', address: '서울시 마포구 독막로 22', date: '2026.05.15 16:45', level: 'risk' },
]

const CONSULTATIONS: Consultation[] = [
  {
    id: 'HS-20260520',
    label: '# 상담 ID: HS-20260520',
    timeAgo: '2시간 전',
    title: '임대인 세금 체납 관련 법적 효력...',
    excerpt: '"현재 분석 중인 계약서 4조 2항의 특약 사항이 임차인에게 다소 불리하게..."',
  },
  {
    id: 'HS-20260519',
    label: '# 상담 ID: HS-20260519',
    timeAgo: '어제',
    title: '전세보증보험 가입 요건 확인',
    excerpt: '"HUG 전세보증보험 가입을 위해 필요한 서류 목록과 집합건물 해당 여부를..."',
  },
]

const LEVEL_LABEL: Record<RiskLevel, string> = {
  safe: 'SAFE (안전)',
  caution: 'CAUTION (주의)',
  risk: 'HIGH RISK (위험)',
}

export function MyPage() {
  const { token, signOut } = useAuth()
  // 조회 실패는 client.ts 의 공통 처리가 오류 모달로 알린다 — 여기서 또 띄우지 않는다.
  const { status, data: currentUser } = useCurrentUser(token)

  const notifyReport = useReportAlertsEnabled()
  const [notifyChat, setNotifyChat] = useState(false)
  const avatarUrl = useAvatarUrl()
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [phone, setPhone] = useState(readStoredPhone)
  const [phoneModalOpen, setPhoneModalOpen] = useState(false)
  const [phoneDraft, setPhoneDraft] = useState(phone)

  const [passwordChanged, setPasswordChanged] = useState(readPasswordChanged)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
// #    setAvatarUrl(URL.createObjectURL(file))
  }

  function openPhoneModal() {
    setPhoneDraft(phone)
    setPhoneModalOpen(true)
  }

  function handlePhoneSave(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = phoneDraft.trim()
    if (!trimmed) {
      showToast('휴대폰 번호를 입력해주세요.', 'error')
      return
    }
    setPhone(trimmed)
    try {
      window.localStorage.setItem(PHONE_STORAGE_KEY, trimmed)
    } catch {
      // 저장 실패해도 화면 표시는 유지된다 — 이번 세션 안에서는 문제 없다.
    }
    setPhoneModalOpen(false)
    showToast('휴대폰 번호가 변경되었습니다.', 'success')
  }

  function openPasswordModal() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordModalOpen(true)
  }

  function handlePasswordSave(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPassword || !newPassword || !confirmPassword) {
      showToast('모든 항목을 입력해주세요.', 'error')
      return
    }
    if (newPassword.length < 8) {
      showToast('새 비밀번호는 8자 이상이어야 합니다.', 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('새 비밀번호가 일치하지 않습니다.', 'error')
      return
    }
    setPasswordChanged(true)
    try {
      window.localStorage.setItem(PASSWORD_CHANGED_STORAGE_KEY, String(Date.now()))
    } catch {
      // 저장 실패해도 화면 표시는 유지된다 — 이번 세션 안에서는 문제 없다.
    }
    setPasswordModalOpen(false)
    showToast('비밀번호가 변경되었습니다.', 'success')
  }

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
        {/* 프로필 */}
        <section className={styles.profile}>
          <div className={styles.avatarWrap}>
            <div className={styles.avatar}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className={styles.avatarImg} />
              ) : (
                <User className={styles.avatarIcon} />
              )}
            </div>
            <button
              type="button"
              className={styles.avatarEdit}
              aria-label="프로필 사진 변경"
              onClick={() => avatarInputRef.current?.click()}
            >
              <Edit />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className={styles.avatarInput}
              onChange={handleAvatarChange}
            />
          </div>
          <h1 className={styles.name} aria-live="polite">
            {status === 'loading' ? (
              <span role="status">프로필을 불러오는 중입니다.</span>
            ) : (
              <>
                {currentUser?.nickname || '회원'} <span className={styles.nameSuffix}>님</span>
              </>
            )}
          </h1>
          <span className={styles.tierBadge}>
            <Check className={styles.tierBadgeIcon} /> 프리미엄 회원
          </span>
          <p className={styles.tagline}>
            안전한 전세 계약을 위해
            <br />
            홈실드가 함께하고 있습니다.
          </p>
        </section>

        {/* 계정 정보 */}
        <section className={styles.card}>
          <div className={styles.infoList}>
            <div className={styles.infoRow}>
              <div>
                <p className={styles.infoLabel}>이메일 주소</p>
                <p className={styles.infoValue}>chulsoo.kim@example.com</p>
              </div>
            </div>
            <div className={styles.infoRow}>
              <div>
                <p className={styles.infoLabel}>휴대폰 번호</p>
                <p className={styles.infoValue}>{phone}</p>
              </div>
              <button type="button" className={styles.linkBtn} onClick={openPhoneModal}>
                수정
              </button>
            </div>
          </div>
        </section>

        {/* 최근 진단 내역 */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <BarChart className={styles.sectionTitleIcon} /> 최근 진단 내역
            </h2>
            <button type="button" className={styles.linkBtn}>
              전체보기
            </button>
          </div>
          <div className={styles.historyList}>
            {HISTORY.map((item) => (
              <div key={item.id} className={styles.historyItem}>
                <div>
                  <h4 className={styles.historyAddress}>{item.address}</h4>
                  <p className={styles.historyDate}>진단 일시: {item.date}</p>
                </div>
                <div className={styles.historyRight}>
                  <span className={`${styles.levelPill} ${styles[`level_${item.level}`]}`}>
                    {LEVEL_LABEL[item.level]}
                  </span>
                  <Link
                    to={`/analyze/${item.id}`}
                    className={styles.historyDetail}
                    aria-label="진단 리포트 보기"
                  >
                    <FileLines />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* 최근 상담 내역 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Chat className={styles.sectionTitleIcon} /> 최근 상담 내역
          </h2>
          <div className={styles.consultGrid}>
            {CONSULTATIONS.map((c) => (
              <div key={c.id} className={styles.consultCard}>
                <div className={styles.consultTop}>
                  <span className={styles.consultId}>{c.label}</span>
                  <span className={styles.consultTime}>{c.timeAgo}</span>
                </div>
                <h4 className={styles.consultTitle}>{c.title}</h4>
                <p className={styles.consultExcerpt}>{c.excerpt}</p>
                <Link to={`/chat/${c.id}`} className={styles.consultCta}>
                  상담 이어서 하기 <ArrowRight />
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* 보안 및 알림 설정 */}
        <section className={styles.card}>
          <div className={styles.cardBody}>
            <h3 className={styles.cardTitle}>보안 설정</h3>
            <div className={styles.settingRow}>
              <div className={styles.settingLeft}>
                <Lock className={styles.settingIcon} />
                <div>
                  <p className={styles.settingLabel}>비밀번호 변경</p>
                  <p className={styles.settingSub}>
                    {passwordChanged ? '방금 변경되었습니다' : '마지막 변경: 3개월 전'}
                  </p>
                </div>
              </div>
              <button type="button" className={styles.linkBtn} onClick={openPasswordModal}>
                변경
              </button>
            </div>
          </div>

          <div className={styles.cardBody}>
            <h3 className={styles.cardTitle}>알림 설정</h3>
            <div className={styles.settingRow}>
              <div>
                <p className={styles.settingLabel}>위험 보고서 생성 완료</p>
                <p className={styles.settingSub}>분석 완료 시 즉시 알림</p>
              </div>
              <Toggle checked={notifyReport} onChange={setReportAlertsEnabled} label="위험 보고서 알림" />
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

        <div className={styles.signOutRow}>
          <button type="button" className={styles.signOutBtn} onClick={handleSignOut}>
            <LogOut /> 로그아웃
          </button>
        </div>
      </div>

      <Link to="/chat" className={styles.fab} aria-label="AI 챗봇 상담 시작하기">
        <Chat />
      </Link>

      <Modal open={phoneModalOpen} onClose={() => setPhoneModalOpen(false)} title="휴대폰 번호 수정">
        <form className={styles.modalForm} onSubmit={handlePhoneSave}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="phone-draft">
              휴대폰 번호
            </label>
            <input
              id="phone-draft"
              type="tel"
              className={styles.input}
              placeholder="010-0000-0000"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              autoFocus
            />
          </div>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setPhoneModalOpen(false)}
            >
              취소
            </button>
            <button type="submit" className={styles.btnPrimary}>
              저장
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={passwordModalOpen}
        onClose={() => setPasswordModalOpen(false)}
        title="비밀번호 변경"
      >
        <form className={styles.modalForm} onSubmit={handlePasswordSave}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="current-password">
              현재 비밀번호
            </label>
            <input
              id="current-password"
              type="password"
              className={styles.input}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoFocus
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-password">
              새 비밀번호
            </label>
            <input
              id="new-password"
              type="password"
              className={styles.input}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="confirm-password">
              새 비밀번호 확인
            </label>
            <input
              id="confirm-password"
              type="password"
              className={styles.input}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setPasswordModalOpen(false)}
            >
              취소
            </button>
            <button type="submit" className={styles.btnPrimary}>
              변경
            </button>
          </div>
        </form>
      </Modal>
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
