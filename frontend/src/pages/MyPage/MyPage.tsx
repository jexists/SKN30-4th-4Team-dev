import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { listAnalyses } from '../../api/analyses'
import { withdrawMember } from '../../api/auth'
import { ErrorState } from '../../components/ErrorState/ErrorState'
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
  Trash,
  User,
} from '../../components/icons'
import { requestDesktopPermission } from '../../hooks/desktopNotify'
import { useAuth } from '../../hooks/useAuth'
import { setAvatarFile, useAvatarUrl } from '../../hooks/useAvatar'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { setDesktopAlertsEnabled, useDesktopAlertsEnabled } from '../../hooks/useNotifications'
import type { AnalysisJobSummary } from '../../types/analysis'
import { isTerminal } from '../../types/analysis'
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

type Consultation = {
  id: string
  label: string
  timeAgo: string
  title: string
  excerpt: string
}

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

/** 서버 risk_level → 화면 뱃지. 진행 중이라 아직 등급이 없으면 별도 처리한다. */
const LEVEL_STYLE = { LOW: 'safe', MEDIUM: 'caution', HIGH: 'risk' } as const
const LEVEL_LABEL = {
  LOW: 'SAFE (안전)',
  MEDIUM: 'CAUTION (주의)',
  HIGH: 'HIGH RISK (위험)',
} as const

/** `2026.05.20 14:30` — 목록에서 한 줄로 읽히는 형식. */
function formatAnalyzedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 카드 제목 — 서버가 준 요약 제목, 없으면 첫 파일명, 그것도 없으면 기본 문구. */
function analysisTitle(job: AnalysisJobSummary): string {
  return job.title || job.file_names[0] || '계약서 분석'
}

export function MyPage() {
  const { token, signOut } = useAuth()
  // 조회 실패는 client.ts 의 공통 처리가 오류 모달로 알린다 — 여기서 또 띄우지 않는다.
  const { status, data: currentUser } = useCurrentUser(token)

  const notifyReport = useDesktopAlertsEnabled()
  const history = useAnalysisHistory()
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

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false)
  const [withdrawAgreed, setWithdrawAgreed] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
// #    setAvatarUrl(URL.createObjectURL(file))
  }

  /**
   * 켤 때만 브라우저 권한을 묻는다 — 사용자 제스처 안에서 물어야 브라우저가 받아준다.
   * 거부당하면 토글을 켜지 않는다(켜져 있는데 배너가 안 오면 고장으로 보인다).
   */
  async function handleDesktopAlertsToggle(next: boolean) {
    if (!next) {
      setDesktopAlertsEnabled(false)
      return
    }
    const granted = await requestDesktopPermission()
    setDesktopAlertsEnabled(granted)
    if (!granted) {
      // API 실패가 아니라 브라우저 설정 문제라 서버가 알려줄 수 없다 — 화면이 직접 말한다.
      showToast('브라우저에서 알림이 차단되어 있습니다. 사이트 설정에서 허용해주세요.', 'error')
    }
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

  function openWithdrawModal() {
    // 동의는 열 때마다 다시 받는다 — 직전에 취소한 체크가 남아 있으면 안 된다.
    setWithdrawAgreed(false)
    setWithdrawModalOpen(true)
  }

  async function handleWithdraw() {
    if (!withdrawAgreed || withdrawing) return

    setWithdrawing(true)
    try {
      await withdrawMember()
    } catch {
      // 실패 안내는 client.ts 의 공통 오류 모달이 맡는다. 모달을 열어둔 채 되돌려
      // 사용자가 곧바로 다시 시도할 수 있게 한다.
      setWithdrawing(false)
      return
    }

    signOut()
    // 보호된 화면(RequireAuth)에서 세션을 끊으면 SPA 내 navigate 는 라우터가 위치를
    // 갱신하기 전에 가드가 먼저 인증 해제를 감지해 /login 으로 보내버리는 경합이 생긴다.
    // 전체 새로고침으로 이동하면 앱이 처음부터 다시 마운트되며 이미 지워진 토큰으로
    // 시작하므로 이 경합 자체가 발생하지 않는다.
    window.location.href = '/login'
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
            <Link to="/risk-report" className={styles.linkBtn}>
              전체보기
            </Link>
          </div>
          {history.status === 'loading' && (
            <p className={styles.historyEmpty} role="status">
              진단 내역을 불러오는 중입니다.
            </p>
          )}
          {history.status === 'error' && (
            <ErrorState message="진단 내역을 불러오지 못했습니다." onRetry={history.retry} />
          )}
          {history.status === 'ok' &&
            (history.items.length === 0 ? (
              <p className={styles.historyEmpty}>
                아직 진단한 계약서가 없습니다. 계약서를 올리면 이곳에 기록이 쌓입니다.
              </p>
            ) : (
              <div className={styles.historyList}>
                {history.items.map((job) => {
                  const done = job.status === 'SUCCEEDED' && job.risk_level !== null
                  return (
                    <div key={job.id} className={styles.historyItem}>
                      <div>
                        <h4 className={styles.historyAddress}>{analysisTitle(job)}</h4>
                        <p className={styles.historyDate}>
                          진단 일시: {formatAnalyzedAt(job.created_at)}
                        </p>
                      </div>
                      <div className={styles.historyRight}>
                        {done ? (
                          <span
                            className={`${styles.levelPill} ${styles[`level_${LEVEL_STYLE[job.risk_level!]}`]}`}
                          >
                            {LEVEL_LABEL[job.risk_level!]}
                          </span>
                        ) : (
                          <span className={styles.levelPill}>
                            {isTerminal(job.status) ? '분석 실패' : '분석 중'}
                          </span>
                        )}
                        <Link
                          to={`/risk-report/${job.id}`}
                          className={styles.historyDetail}
                          aria-label={`${analysisTitle(job)} 진단 리포트 보기`}
                        >
                          <FileLines />
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
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
                {/* 알림 자체는 항상 쌓인다 — 이 토글이 정하는 건 브라우저 배너·토스트뿐이다. */}
                <p className={styles.settingSub}>분석이 끝나면 브라우저 알림으로 알려드립니다</p>
              </div>
              <Toggle
                checked={notifyReport}
                onChange={(next) => void handleDesktopAlertsToggle(next)}
                label="위험 보고서 알림"
              />
            </div>
          </div>
        </section>

        <div className={styles.withdrawRow}>
          <button type="button" className={styles.withdrawBtn} onClick={openWithdrawModal}>
            <Trash /> 회원 탈퇴
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

      <Modal
        open={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
        title="회원 탈퇴"
      >
        <div className={styles.withdrawBody}>
          <p className={styles.withdrawQuestion}>정말 회원 탈퇴하시겠습니까?</p>
          <p className={styles.withdrawWarning}>
            탈퇴 시 계정 정보와 채팅, 계약서 등 모든 데이터가 삭제되며 복구할 수 없습니다.
          </p>
          <label className={styles.withdrawAgree}>
            <input
              type="checkbox"
              checked={withdrawAgreed}
              onChange={(e) => setWithdrawAgreed(e.target.checked)}
            />
            <span>위 내용을 확인했으며 회원 탈퇴에 동의합니다.</span>
          </label>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setWithdrawModalOpen(false)}
              disabled={withdrawing}
            >
              취소
            </button>
            {/* 동의 전에는 누를 수 없다 — 되돌릴 수 없는 액션이라 오조작을 막는다. */}
            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => void handleWithdraw()}
              disabled={!withdrawAgreed || withdrawing}
            >
              {withdrawing ? '처리 중…' : '회원 탈퇴'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

/**
 * 최근 진단 내역. 목록에는 요약만 오므로(결과 payload 없음) 가볍다.
 *
 * 실패를 빈 목록으로 그리지 않는다 — 서버 장애가 "진단한 적 없음"으로 보이면 안 된다.
 */
function useAnalysisHistory() {
  const [items, setItems] = useState<AnalysisJobSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    listAnalyses(null, 5)
      .then((page) => {
        if (cancelled) return
        setItems(page.items)
        setStatus('ok')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return { items, status, retry: () => setReloadKey((key) => key + 1) }
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
