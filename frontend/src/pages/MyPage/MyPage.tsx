import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { updateNickname, updateNotificationPref, uploadAvatar, withdrawMember } from '../../api/auth'
import type { ChatRoom } from '../../api/chatHistory'
import { listRooms } from '../../api/chatHistory'
import { ErrorState } from '../../components/ErrorState/ErrorState'
import { Modal } from '../../components/Modal/Modal'
import { relativeTime } from '../../components/NotificationBell/relativeTime'
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
import { supabase } from '../../config/supabase'
import { requestDesktopPermission } from '../../hooks/desktopNotify'
import {
  analysisTitle,
  formatAnalyzedAt,
  isAnalysisFailed,
  riskBadge,
  useAnalysisHistory,
} from '../../hooks/useAnalysisHistory'
import { useAuth } from '../../hooks/useAuth'
import { useCurrentUser } from '../../hooks/useCurrentUser'
import { setDesktopAlertsEnabled, useDesktopAlertsEnabled } from '../../hooks/useNotifications'
import styles from './MyPage.module.scss'

/** 로그인 수단 — Supabase 가 app_metadata.provider 에 넣어주는 값("email"/"kakao")을 한국어로. */
const LOGIN_PROVIDER_LABEL: Record<string, string> = {
  email: '이메일',
  kakao: '카카오톡',
}

function loginProviderLabel(provider: string | null | undefined): string {
  if (!provider) return '알 수 없음'
  return LOGIN_PROVIDER_LABEL[provider] ?? provider
}

/** 카드 상단 배지 — 실제 id 는 UUID 라 그대로 못 쓰므로 앞 8자리만 축약해 보여준다. */
function consultLabel(room: ChatRoom): string {
  return `# 상담 ID: ${room.id.slice(0, 8).toUpperCase()}`
}

/** 카드 제목 — 방 제목(첫 질문 요약), 아직 없으면 기본 문구. */
function consultTitle(room: ChatRoom): string {
  return room.title || '새 상담'
}

export function MyPage() {
  const { token, signOut } = useAuth()
  // 조회 실패는 client.ts 의 공통 처리가 오류 모달로 알린다 — 여기서 또 띄우지 않는다.
  const { status, data: currentUser, setCurrentUser } = useCurrentUser(token)

  const notifyReport = useDesktopAlertsEnabled()
  const history = useAnalysisHistory()
  const consultHistory = useConsultationHistory()
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)

  // 서버 값(profile.notify_report_complete)이 진실 공급원이다 — 로그인 직후·다른
  // 기기에서 바꾼 설정도 이 화면을 열 때 반영되게 로컬 스토어를 맞춘다.
  useEffect(() => {
    if (currentUser) setDesktopAlertsEnabled(currentUser.notify_report_complete)
  }, [currentUser])

  const [nicknameModalOpen, setNicknameModalOpen] = useState(false)
  const [nicknameDraft, setNicknameDraft] = useState('')
  const [nicknameSaving, setNicknameSaving] = useState(false)

  const [passwordChanged, setPasswordChanged] = useState(false)
  const [passwordModalOpen, setPasswordModalOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)

  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false)
  const [withdrawAgreed, setWithdrawAgreed] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 파일을 다시 골라도 onChange 가 또 뜨도록 초기화
    if (!file || avatarUploading) return

    setAvatarUploading(true)
    try {
      const updated = await uploadAvatar(file)
      setCurrentUser(updated)
    } catch {
      // 실패 안내는 client.ts 의 공통 오류 모달이 맡는다.
    } finally {
      setAvatarUploading(false)
    }
  }

  /**
   * 켤 때만 브라우저 권한을 묻는다 — 사용자 제스처 안에서 물어야 브라우저가 받아준다.
   * 거부당하면 토글을 켜지 않는다(켜져 있는데 배너가 안 오면 고장으로 보인다).
   */
  async function handleDesktopAlertsToggle(next: boolean) {
    if (!next) {
      setDesktopAlertsEnabled(false)
      try {
        const updated = await updateNotificationPref(false)
        setCurrentUser(updated)
      } catch {
        // 실패 안내는 client.ts 의 공통 오류 모달이 맡는다 — 로컬 배너는 꺼진 채로 둔다.
      }
      return
    }
    const granted = await requestDesktopPermission()
    setDesktopAlertsEnabled(granted)
    if (!granted) {
      // API 실패가 아니라 브라우저 설정 문제라 서버가 알려줄 수 없다 — 화면이 직접 말한다.
      showToast('브라우저에서 알림이 차단되어 있습니다. 사이트 설정에서 허용해주세요.', 'error')
      return
    }
    try {
      const updated = await updateNotificationPref(true)
      setCurrentUser(updated)
    } catch {
      // 실패 안내는 client.ts 의 공통 오류 모달이 맡는다.
    }
  }

  function openNicknameModal() {
    setNicknameDraft(currentUser?.nickname ?? '')
    setNicknameModalOpen(true)
  }

  async function handleNicknameSave(e: React.FormEvent) {
    e.preventDefault()
    if (nicknameSaving) return
    const trimmed = nicknameDraft.trim()
    if (!trimmed) {
      showToast('닉네임을 입력해주세요.', 'error')
      return
    }
    setNicknameSaving(true)
    try {
      const updated = await updateNickname(trimmed)
      setCurrentUser(updated)
      setNicknameModalOpen(false)
    } catch {
      // 실패 안내는 client.ts 의 공통 오류 모달이 맡는다 — 모달은 열어둔 채 재시도할 수 있게 한다.
    } finally {
      setNicknameSaving(false)
    }
  }

  function openPasswordModal() {
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordModalOpen(true)
  }

  /**
   * 비밀번호는 우리 DB 가 아니라 Supabase Auth 가 관리한다 — 변경도 그쪽 API 로 해야
   * 실제로 반영된다. 현재 비밀번호는 signInWithPassword 로 재인증해 확인한다(Supabase
   * Auth 에 "비밀번호만 검증" API 가 따로 없어, 재로그인 시도가 곧 검증이다).
   */
  async function handlePasswordSave(e: React.FormEvent) {
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
    if (!supabase || !currentUser?.email) {
      showToast('로그인 서비스가 아직 설정되지 않았습니다.', 'error')
      return
    }
    if (passwordSaving) return

    setPasswordSaving(true)
    try {
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: currentUser.email,
        password: currentPassword,
      })
      if (reauthError) {
        showToast('현재 비밀번호가 올바르지 않습니다.', 'error')
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) {
        showToast('비밀번호를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error')
        return
      }

      setPasswordChanged(true)
      setPasswordModalOpen(false)
      showToast('비밀번호가 변경되었습니다.', 'success')
    } finally {
      setPasswordSaving(false)
    }
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
              {currentUser?.profile_image ? (
                <img src={currentUser.profile_image} alt="" className={styles.avatarImg} />
              ) : (
                <User className={styles.avatarIcon} />
              )}
            </div>
            <button
              type="button"
              className={styles.avatarEdit}
              aria-label="프로필 사진 변경"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
            >
              <Edit />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              aria-label="프로필 사진 변경"
              className={styles.avatarInput}
              onChange={(e) => void handleAvatarChange(e)}
            />
          </div>
          <h1 className={styles.name} aria-live="polite">
            {status === 'loading' ? (
              <span role="status">프로필을 불러오는 중입니다.</span>
            ) : (
              <>
                {currentUser?.nickname || '회원'} <span className={styles.nameSuffix}></span>
              </>
            )}
          </h1>
          <span className={styles.tierBadge}>
            <Check className={styles.tierBadgeIcon} /> 일반회원
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
                <p className={styles.infoLabel}>닉네임</p>
                <p className={styles.infoValue}>{currentUser?.nickname || '회원'}</p>
              </div>
              <button type="button" className={styles.linkBtn} onClick={openNicknameModal}>
                수정
              </button>
            </div>
            <div className={styles.infoRow}>
              <div>
                <p className={styles.infoLabel}>로그인 경로</p>
                <p className={styles.infoValue}>{loginProviderLabel(currentUser?.login_provider)}</p>
              </div>
            </div>
          </div>
        </section>

        {/* 최근 진단 내역 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <BarChart className={styles.sectionTitleIcon} /> 최근 진단 내역
          </h2>
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
                  const badge = riskBadge(job)
                  return (
                    <div key={job.id} className={styles.historyItem}>
                      <div>
                        <h4 className={styles.historyAddress}>{analysisTitle(job)}</h4>
                        <p className={styles.historyDate}>
                          진단 일시: {formatAnalyzedAt(job.created_at)}
                        </p>
                      </div>
                      <div className={styles.historyRight}>
                        {/* 등급이 없는 상태(분석 중·실패)는 level_* 가 없어 기본 pill 모습이 된다. */}
                        <span
                          className={[styles.levelPill, styles[`level_${badge.tone}`]]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {badge.label}
                        </span>
                        {/*
                          실패한 기록은 열어도 보여줄 리포트가 없다. 버튼을 없애면 행마다
                          오른쪽 폭이 달라져 목록이 어긋나므로, 자리는 그대로 두고 누르면
                          토스트로 이유를 알린다(API 실패가 아니라 화면이 아는 사실이다).
                        */}
                        {isAnalysisFailed(job) ? (
                          <button
                            type="button"
                            className={styles.historyDetail}
                            aria-label={`${analysisTitle(job)} 진단 리포트 보기`}
                            onClick={() =>
                              showToast('분석에 실패한 기록이라 리포트를 열 수 없습니다.', 'error')
                            }
                          >
                            <FileLines />
                          </button>
                        ) : (
                          <Link
                            to={`/risk-report/${job.id}`}
                            className={styles.historyDetail}
                            aria-label={`${analysisTitle(job)} 진단 리포트 보기`}
                          >
                            <FileLines />
                          </Link>
                        )}
                      </div>
                    </div>
                  )
                })}
                {history.hasMore && (
                  <button
                    type="button"
                    className={styles.historyLoadMore}
                    onClick={() => void history.loadMore()}
                    disabled={history.loadingMore}
                  >
                    {history.loadingMore ? '불러오는 중입니다...' : '더 보기'}
                  </button>
                )}
              </div>
            ))}
        </section>

        {/* 최근 상담 내역 */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              <Chat className={styles.sectionTitleIcon} /> 최근 상담 내역
            </h2>
            <Link to="/chat" className={styles.linkBtn}>
              전체보기
            </Link>
          </div>
          {consultHistory.status === 'loading' && (
            <p className={styles.historyEmpty} role="status">
              상담 내역을 불러오는 중입니다.
            </p>
          )}
          {consultHistory.status === 'error' && (
            <ErrorState message="상담 내역을 불러오지 못했습니다." onRetry={consultHistory.retry} />
          )}
          {consultHistory.status === 'ok' &&
            (consultHistory.items.length === 0 ? (
              <p className={styles.historyEmpty}>
                아직 진행한 상담이 없습니다. 챗봇에게 물어보면 이곳에 기록이 쌓입니다.
              </p>
            ) : (
              <div className={styles.consultGrid}>
                {consultHistory.items.map((room) => (
                  <div key={room.id} className={styles.consultCard}>
                    <div className={styles.consultTop}>
                      <span className={styles.consultId}>{consultLabel(room)}</span>
                      <span className={styles.consultTime}>{relativeTime(room.last_chat_at)}</span>
                    </div>
                    <h4 className={styles.consultTitle}>{consultTitle(room)}</h4>
                    <p className={styles.consultExcerpt}>
                      {room.last_message_preview
                        ? `"${room.last_message_preview}"`
                        : '아직 대화 내용이 없습니다.'}
                    </p>
                    <Link to={`/chat/${room.id}`} className={styles.consultCta}>
                      상담 이어서 하기 <ArrowRight />
                    </Link>
                  </div>
                ))}
              </div>
            ))}
        </section>

        {/* 보안 및 알림 설정 */}
        <section className={styles.card}>
          {/* 카카오 로그인 계정은 Supabase Auth 에 비밀번호 자체가 없다 — 이메일 로그인만 보여준다. */}
          {currentUser?.login_provider === 'email' && (
            <div className={styles.cardBody}>
              <h3 className={styles.cardTitle}>보안 설정</h3>
              <div className={styles.settingRow}>
                <div className={styles.settingLeft}>
                  <Lock className={styles.settingIcon} />
                  <div>
                    <p className={styles.settingLabel}>비밀번호 변경</p>
                    {/* <p className={styles.settingSub}>
                      {passwordChanged ? '방금 변경되었습니다' : '마지막 변경: 3개월 전'}
                    </p> */}
                  </div>
                </div>
                <button type="button" className={styles.linkBtn} onClick={openPasswordModal}>
                  변경
                </button>
              </div>
            </div>
          )}

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

      <Modal
        open={nicknameModalOpen}
        onClose={() => setNicknameModalOpen(false)}
        title="닉네임 변경"
      >
        <form className={styles.modalForm} onSubmit={handleNicknameSave}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="nickname-draft">
              닉네임
            </label>
            <input
              id="nickname-draft"
              type="text"
              className={styles.input}
              placeholder="닉네임을 입력해주세요"
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              maxLength={20}
              autoFocus
            />
          </div>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setNicknameModalOpen(false)}
            >
              취소
            </button>
            <button type="submit" className={styles.btnPrimary} disabled={nicknameSaving}>
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
            <button type="submit" className={styles.btnPrimary} disabled={passwordSaving}>
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

/** 최근 상담 내역. 카드 2개짜리 그리드라 최신 2개만 가져오고, 전체는 "전체보기"(=/chat)로 보낸다. */
function useConsultationHistory() {
  const [items, setItems] = useState<ChatRoom[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    listRooms(null, 2)
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
