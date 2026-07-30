import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import apartmentImg from '../../../assets/images/apartment.png'
import officetelImg from '../../../assets/images/efficiency_apartment.png'
import houseImg from '../../../assets/images/house.png'
import villaImg from '../../../assets/images/multiplex_housing.png'
import {
  ANALYSIS_TITLE_MAX,
  deleteAnalysis,
  getAnalysis,
  updateAnalysisTitle,
} from '../../api/analyses'
import { isRetryable } from '../../api/apiErrorHandler'
import { ErrorState } from '../../components/ErrorState/ErrorState'
import { KakaoMap } from '../../components/KakaoMap/KakaoMap'
import { Modal } from '../../components/Modal/Modal'
import {
  Building,
  Check,
  ClipboardCheck,
  Download,
  Edit,
  Info,
  MoreVertical,
  Trash,
  Warn,
} from '../../components/icons'
import {
  analysisTitle,
  formatAnalyzedAt,
  isAnalysisFailed,
  riskBadge,
  useAnalysisHistory,
} from '../../hooks/useAnalysisHistory'
import { markAnalysisFinished, markResourceNotificationsRead } from '../../hooks/useNotifications'
import type {
  AnalysisJobDetail,
  AnalysisJobSummary,
  AnalysisResult,
  AnalysisStage,
} from '../../types/analysis'
import { isTerminal } from '../../types/analysis'
import type { RiskSeverity } from '../../types/document'
import { contractTypeOf } from './contractType'
import styles from './RiskReport.module.scss'

/**
 * 종합 리스크 리포트.
 *
 * 예전엔 `location.state` 로 결과를 받아 **새로고침하면 사라졌다.** 지금은 URL 의 jobId 가
 * 유일한 입력이고 결과는 서버에 있다 — 링크를 공유하거나 알림에서 들어와도 같은 화면이 뜬다.
 *
 * jobId 가 없는 `/risk-report` 는 **지금까지 분석한 목록**이다. 예전엔 가장 최근 결과로
 * 곧바로 리다이렉트했는데, 그러면 이전 분석을 보려고 마이페이지까지 돌아가야 했다.
 *
 * 분석은 30초~2분짜리라 결과 화면에 알림보다 먼저 도착할 수 있다. 그래서 이 화면 자체가
 * 진행 상태를 그리고 폴링한다 — 막다른 길을 만들지 않기 위함이다.
 */

const POLL_MS = 5_000

/** 백엔드 규칙 분석기가 뽑아내는 property_type 원문(analyzer.py 의 정규식)과 1:1 매핑. */
const PROPERTY_TYPE_IMAGE: Record<string, string> = {
  아파트: apartmentImg,
  오피스텔: officetelImg,
  단독주택: houseImg,
  다가구주택: houseImg,
  연립주택: villaImg,
  다세대주택: villaImg,
}

/** 진행 화면 문구. 서버 stage 는 참고용이라 모르는 값이 와도 화면이 깨지지 않게 기본값을 둔다. */
const STAGE_LABEL: Record<AnalysisStage, string> = {
  UPLOADING: '파일을 준비하고 있습니다',
  OCR: '문서에서 글자를 읽고 있습니다',
  ANALYZING: '계약 조항을 분석하고 있습니다',
  RAG: '관련 법령과 판례를 찾고 있습니다',
  LLM: 'AI가 위험 요소를 검토하고 있습니다',
  SAVING: '결과를 저장하고 있습니다',
  COMPLETED: '마무리하고 있습니다',
}

type ClauseTone = 'risk' | 'safe' | 'neutral'

type Clause = {
  tone: ClauseTone
  title: string
  quote: string
  verdict: string
  detail: string
}

const TONE_ICON: Record<ClauseTone, typeof Warn> = {
  risk: Warn,
  safe: Check,
  neutral: Info,
}

const SEVERITY_TONE: Record<RiskSeverity, ClauseTone> = {
  HIGH: 'risk',
  MEDIUM: 'risk',
  LOW: 'safe',
}

// ── 진입점 ─────────────────────────────────────────────────────────────

export function RiskReport() {
  const { jobId } = useParams<{ jobId?: string }>()
  // 헤더의 "위험 보고서" 내비는 id 없이 들어온다 — 분석 목록을 보여준다.
  return jobId ? <JobReport jobId={jobId} /> : <AnalysisHistoryPanel />
}

// ── /risk-report (id 없음) — 지금까지 분석한 목록 ───────────────────────

/**
 * 진행 중·실패한 분석도 목록에 남긴다. 진행 중 항목을 누르면 `/risk-report/:jobId` 의
 * 진행 화면이 이어서 폴링하므로 어느 항목도 막다른 길이 아니다.
 *
 * 목록 마크업은 마이페이지 "최근 진단 내역" 과 비슷하지만 톤이 달라 각자 그린다.
 * 세 번째 화면이 같은 목록을 요구하면 `components/AnalysisHistoryList` 로 뽑을 자리다.
 */
function AnalysisHistoryPanel() {
  const navigate = useNavigate()
  const { items, status, error, hasMore, loadingMore, loadMore, applyTitle, removeItem, retry } =
    useAnalysisHistory(5)
  // 열려 있는 모달은 한 번에 하나다 — 어떤 항목에 대한 무슨 작업인지만 들고 있는다.
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'delete'
    job: AnalysisJobSummary
  } | null>(null)

  if (status === 'loading') return <LoadingPanel label="분석 기록을 불러오고 있습니다" />

  // 실패를 빈 목록으로 그리지 않는다 — 서버 장애가 "분석한 적 없음"으로 보이면 안 된다.
  if (status === 'error') {
    return (
      <CenteredPanel>
        <ErrorState
          variant="plain"
          message="분석 기록을 불러오지 못했습니다."
          onRetry={isRetryable(error) ? retry : undefined}
          action={{ label: '분석하러 가기', onClick: () => navigate('/analyze') }}
        />
      </CenteredPanel>
    )
  }

  if (items.length === 0) {
    return (
      <CenteredPanel>
        <h1 className={styles.stateTitle}>아직 분석한 계약서가 없습니다.</h1>
        <p className={styles.stateDesc}>
          계약서와 등기부등본을 올리면 위험 요소를 정리한 리포트를 만들어 드립니다.
        </p>
        <Link to="/analyze" className={styles.stateCta}>
          계약서 분석하기
        </Link>
      </CenteredPanel>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.listHead}>
          <h1 className={styles.title}>최근 진단 내역</h1>
          {/* 목록이 길어져도 스크롤 없이 다음 분석으로 갈 수 있게 헤더에 둔다. */}
          <Link to="/analyze" className={styles.listCta}>
            새 계약서 분석하기
          </Link>
        </header>

        <div className={styles.list}>
          {items.map((job) => (
            <HistoryRow
              key={job.id}
              job={job}
              onRename={() => setDialog({ kind: 'rename', job })}
              onDelete={() => setDialog({ kind: 'delete', job })}
            />
          ))}
          {hasMore && (
            <button
              type="button"
              className={styles.loadMore}
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? '불러오는 중입니다...' : '더 보기'}
            </button>
          )}
        </div>
      </div>

      {dialog?.kind === 'rename' && (
        <RenameAnalysisModal
          job={dialog.job}
          onClose={() => setDialog(null)}
          onSaved={(title) => {
            applyTitle(dialog.job.id, title)
            setDialog(null)
          }}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteAnalysisModal
          job={dialog.job}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            removeItem(dialog.job.id)
            setDialog(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * 목록의 한 줄.
 *
 * **실패한 분석은 누를 수 없다** — 열어도 보여줄 리포트가 없고, 실패 화면으로 보내면 목록으로
 * 돌아오는 걸음만 늘어난다. 그래서 링크가 아니라 그냥 줄로 그린다(알림 목록과 같은 규칙).
 * 대신 ⋮ 메뉴는 모든 행에 있어 **오른쪽 폭이 같다** — 실패 행만 배지가 밀려 보이지 않는다.
 *
 * 링크(`<a>`) 안에는 버튼을 넣을 수 없으므로 행을 감싸는 div 를 두고 메뉴를 그 바깥에 둔다.
 */
function HistoryRow({
  job,
  onRename,
  onDelete,
}: {
  job: AnalysisJobSummary
  onRename: () => void
  onDelete: () => void
}) {
  const title = analysisTitle(job)
  const badge = riskBadge(job)
  const failed = isAnalysisFailed(job)

  const main = (
    <>
      <span className={styles.listRowText}>
        <span className={styles.listTitle}>{title}</span>
        <span className={styles.listDate}>진단 일시: {formatAnalyzedAt(job.created_at)}</span>
      </span>
      {/* 등급이 없는 상태(분석 중·실패)는 level_* 가 없어 기본 pill 모습이 된다. */}
      <span className={[styles.levelPill, styles[`level_${badge.tone}`]].filter(Boolean).join(' ')}>
        {badge.label}
      </span>
    </>
  )

  return (
    <div className={styles.listRow}>
      {failed ? (
        <div className={`${styles.listRowMain} ${styles.listRowStatic}`}>{main}</div>
      ) : (
        <Link
          to={`/risk-report/${job.id}`}
          className={styles.listRowMain}
          aria-label={`${title} 리포트 보기`}
        >
          {main}
        </Link>
      )}
      {/* 제목은 산출물에 있다 — 결과가 없는 실패 기록은 고칠 자리가 없어 삭제만 준다. */}
      <RowMenu title={title} onRename={failed ? undefined : onRename} onDelete={onDelete} />
    </div>
  )
}

/** ⋮ 메뉴. 바깥을 누르거나 Escape 로 닫힌다 — 채팅 사이드바(ChatRoomItem)와 같은 규칙이다. */
function RowMenu({
  title,
  onRename,
  onDelete,
}: {
  title: string
  onRename?: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className={styles.rowMenu} ref={rootRef}>
      <button
        type="button"
        className={`${styles.rowMenuTrigger} ${open ? styles.rowMenuTriggerOpen : ''}`}
        aria-label={`${title} 옵션`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <MoreVertical />
      </button>

      {open && (
        <div className={styles.menu} role="menu">
          {onRename && (
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => {
                setOpen(false)
                onRename()
              }}
            >
              <Edit />
              제목 수정
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className={`${styles.menuItem} ${styles.menuItemDanger}`}
            onClick={() => {
              setOpen(false)
              onDelete()
            }}
          >
            <Trash />
            삭제
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 제목 수정·삭제 모달.
 *
 * 실패 원인은 client.ts 의 공통 오류 모달이 알린다 — 여기선 진행 상태만 풀고 모달을 열어 둬
 * 사용자가 그대로 다시 시도할 수 있게 한다(채팅방 모달과 같은 규칙).
 */
function RenameAnalysisModal({
  job,
  onClose,
  onSaved,
}: {
  job: AnalysisJobSummary
  onClose: () => void
  onSaved: (title: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState(analysisTitle(job))
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = title.trim()
    if (!trimmed || saving) return

    setSaving(true)
    try {
      const updated = await updateAnalysisTitle(job.id, trimmed)
      onSaved(updated.title ?? trimmed)
    } catch {
      // 공통 오류 모달이 원인을 말한다.
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      title="분석 제목 수정"
      onClose={() => !saving && onClose()}
      initialFocusRef={inputRef}
    >
      <form className={styles.dialogForm} onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="analysis-title">분석 제목</label>
        <input
          id="analysis-title"
          ref={inputRef}
          className={styles.dialogInput}
          defaultValue={analysisTitle(job)}
          maxLength={ANALYSIS_TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className={styles.dialogActions}>
          <button type="button" className={styles.dialogCancel} disabled={saving} onClick={onClose}>
            취소
          </button>
          <button type="submit" className={styles.dialogSubmit} disabled={saving || !title.trim()}>
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteAnalysisModal({
  job,
  onClose,
  onDeleted,
}: {
  job: AnalysisJobSummary
  onClose: () => void
  onDeleted: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (deleting) return
    setDeleting(true)
    try {
      await deleteAnalysis(job.id)
      onDeleted()
    } catch {
      // 공통 오류 모달이 원인을 말한다(진행 중이라 지울 수 없는 경우 포함).
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Modal open title="분석 기록 삭제" onClose={() => !deleting && onClose()}>
      <div className={styles.dialogForm}>
        <p className={styles.dialogText}>
          {analysisTitle(job)} 기록을 삭제하시겠습니까?
          <span>삭제한 기록은 복구할 수 없습니다.</span>
        </p>
        <div className={styles.dialogActions}>
          <button
            type="button"
            className={styles.dialogCancel}
            disabled={deleting}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className={styles.dialogDanger}
            disabled={deleting}
            onClick={() => void handleDelete()}
          >
            {deleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── /risk-report/:jobId ────────────────────────────────────────────────

function JobReport({ jobId }: { jobId: string }) {
  const navigate = useNavigate()
  const { job, error, loading, retry } = useAnalysisJob(jobId)

  // 결과를 봤으면 그 작업의 알림은 이미 확인한 것이다 — 배지에 남겨두지 않는다.
  useEffect(() => {
    if (!job || !isTerminal(job.status)) return
    markAnalysisFinished()
    void markResourceNotificationsRead(job.id)
  }, [job])

  if (loading && !job) return <LoadingPanel label="분석 결과를 불러오고 있습니다" />

  if (!job) {
    return (
      <CenteredPanel>
        <ErrorState
          variant="plain"
          message="분석 결과를 불러오지 못했습니다."
          onRetry={isRetryable(error) ? retry : undefined}
          action={{ label: '분석하러 가기', onClick: () => navigate('/analyze') }}
        />
      </CenteredPanel>
    )
  }

  if (!isTerminal(job.status)) {
    return <RunningPanel job={job} />
  }

  if (job.status === 'FAILED' || job.status === 'CANCELLED') {
    return (
      <CenteredPanel>
        <ErrorState
          variant="plain"
          // 문구 소유권은 서버에 있다 — error.message 를 그대로 보여준다.
          message={job.error?.message ?? '분석에 실패했습니다.'}
          action={{ label: '다시 분석하기', onClick: () => navigate('/analyze') }}
        />
      </CenteredPanel>
    )
  }

  if (!job.result) {
    // SUCCEEDED 인데 결과가 없다 — 있어선 안 되는 조합이라 빈 화면 대신 실패로 다룬다.
    return (
      <CenteredPanel>
        <ErrorState
          variant="plain"
          message="분석 결과를 찾을 수 없습니다."
          action={{ label: '다시 분석하기', onClick: () => navigate('/analyze') }}
        />
      </CenteredPanel>
    )
  }

  return <ReportBody result={job.result} />
}

/**
 * 작업 상태를 읽고, 끝나지 않았으면 5초마다 다시 읽는다.
 *
 * 폴링 중 일시적 실패는 **이미 그린 진행 화면을 덮지 않는다** — 다음 주기에 다시 시도한다.
 * 처음부터 못 읽은 경우에만 오류로 표현한다(그때는 보여줄 게 아무것도 없다).
 */
function useAnalysisJob(jobId: string) {
  const [job, setJob] = useState<AnalysisJobDetail | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const jobRef = useRef<AnalysisJobDetail | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    jobRef.current = null
    setJob(null)
    setError(null)
    setLoading(true)

    const poll = async () => {
      try {
        // silent: 폴링이라 실패할 때마다 오류 모달이 뜨면 화면을 덮는다.
        const next = await getAnalysis(jobId, true)
        if (cancelled) return
        jobRef.current = next
        setJob(next)
        setError(null)
        if (!isTerminal(next.status)) timer = setTimeout(() => void poll(), POLL_MS)
      } catch (caught) {
        if (cancelled) return
        if (jobRef.current === null) setError(caught)
        else timer = setTimeout(() => void poll(), POLL_MS)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [jobId, reloadKey])

  const retry = useCallback(() => setReloadKey((key) => key + 1), [])
  return { job, error, loading, retry }
}

// ── 상태 화면 ──────────────────────────────────────────────────────────

function CenteredPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${styles.page} ${styles.statePage}`}>
      <div className={`${styles.container} ${styles.statePanel}`}>{children}</div>
    </div>
  )
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <CenteredPanel>
      <div className={styles.stateStatus} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <p>{label}</p>
      </div>
    </CenteredPanel>
  )
}

function RunningPanel({ job }: { job: AnalysisJobDetail }) {
  const label = job.stage
    ? (STAGE_LABEL[job.stage] ?? '분석을 진행하고 있습니다')
    : '분석을 준비하고 있습니다'
  return (
    <CenteredPanel>
      <div className={styles.stateStatus} role="status">
        <span className={styles.spinner} aria-hidden="true" />
        <p>{label}</p>
      </div>
      <p className={styles.stateDesc}>
        분석에는 약 30초~2분이 걸립니다. 이 화면을 닫아도 완료되면 알림으로 알려드립니다.
      </p>
      {job.progress > 0 && (
        <div
          className={styles.progressBar}
          role="progressbar"
          aria-valuenow={job.progress}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className={styles.progressFill} style={{ width: `${job.progress}%` }} />
        </div>
      )}
      <Link to="/chat" className={styles.stateCta}>
        기다리는 동안 AI 상담하기
      </Link>
    </CenteredPanel>
  )
}

// ── 리포트 본문 ────────────────────────────────────────────────────────

function ReportBody({ result }: { result: AnalysisResult }) {
  const analysis = result.analysis
  const terms = analysis.terms
  // LLM 은 property_type 을 자유 문자열로 내려준다("다중주택"·"근린생활시설" 등).
  // 매핑에 없는 값이 흔해서 아이콘으로 떨어뜨리지 않고 아파트 사진을 기본값으로 쓴다.
  const propertyImage =
    (terms.property_type && PROPERTY_TYPE_IMAGE[terms.property_type]) || apartmentImg
  const [imageFailed, setImageFailed] = useState(false)

  const analyzedClauses: Clause[] = analysis.risks.map((risk) => ({
    tone: SEVERITY_TONE[risk.severity],
    title: risk.title,
    quote: risk.clause || '계약서 전체 문맥을 기준으로 검토한 항목입니다.',
    verdict: risk.severity === 'HIGH' ? '고위험' : risk.severity === 'MEDIUM' ? '주의' : '낮음',
    detail: risk.reason,
  }))
  const clauses: Clause[] = analyzedClauses.length
    ? analyzedClauses
    : [
        {
          tone: 'safe',
          title: '명시적인 고위험 조항 없음',
          quote: '자동 분석에서 즉시 경고할 계약 조항을 찾지 못했습니다.',
          verdict: '확인',
          detail: '등기부등본과 실제 권리관계는 별도로 확인해야 합니다.',
        },
      ]
  const actions = analysis.risks.length
    ? analysis.risks.map((risk) => ({ title: risk.title, desc: risk.recommendation }))
    : [
        {
          title: '권리관계 별도 확인',
          desc: '자동 분석에서 고위험 조항은 없었지만 최신 등기부등본과 체납 여부를 확인하세요.',
        },
      ]

  const highCount = analysis.risks.filter((risk) => risk.severity === 'HIGH').length
  const mediumCount = analysis.risks.filter((risk) => risk.severity === 'MEDIUM').length
  const lowCount = analysis.risks.filter((risk) => risk.severity === 'LOW').length
  const score = Math.max(20, 100 - highCount * 25 - mediumCount * 12 - lowCount * 4)
  const scoreLabel = score >= 80 ? '안전' : score >= 60 ? '주의' : '위험'
  const riskPercent = 100 - score
  const period = [terms.contract_start, terms.contract_end].filter(Boolean).join(' ~ ') || '미확인'
  const contractType = contractTypeOf(terms.contract_type, terms.monthly_rent)

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>종합 리스크 리포트</h1>
            {/* 계약 유형(전세/월세)은 "주요 계약 조건" 카드가 소유한다. 여기는 건물 유형이다. */}
            <p className={styles.subtitle}>
              건물 유형: {terms.property_type || '주택 임대차계약서'}
            </p>
          </div>
          <div className={styles.headerActions}>
            {/*
              마스킹 PDF 를 서버에 보관하지 않으므로 브라우저 인쇄로 대신한다.
              글자를 선택·검색할 수 있는 PDF 가 나오고, 새 의존성도 늘지 않는다.
            */}
            <button type="button" className={styles.btnOutline} onClick={() => window.print()}>
              <Download /> PDF 다운로드
            </button>
          </div>
        </header>

        <div className={styles.bento}>
          <section className={styles.scoreCard}>
            <h3 className={styles.cardTitle}>종합 안전 점수</h3>
            <div className={styles.gauge}>
              <svg className={styles.gaugeSvg} viewBox="0 0 100 100">
                <circle className={styles.gaugeTrack} cx="50" cy="50" r="45" />
                <circle
                  className={styles.gaugeFill}
                  cx="50"
                  cy="50"
                  r="45"
                  strokeDasharray="283"
                  strokeDashoffset={283 * (1 - score / 100)}
                />
              </svg>
              <div className={styles.gaugeText}>
                <span className={styles.gaugeNum}>{score}</span>
                <span className={styles.gaugeLabel}>{scoreLabel}</span>
              </div>
            </div>
            <p className={styles.scoreDesc}>{analysis.summary}</p>
          </section>

          <section className={styles.financeCard}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>주요 계약 조건</h3>
              <span className={styles.warnPill}>{highCount}개 고위험 항목</span>
            </div>
            {/* 전세는 월세 칸을 그리지 않는다 — "월세: 없음" 은 정보가 아니라 잡음이다. */}
            <div
              className={`${styles.financeGrid} ${
                contractType === '월세' ? styles.financeGridQuad : ''
              }`}
            >
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>계약 유형</p>
                <p className={styles.financeValue}>{contractType}</p>
              </div>
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>보증금</p>
                <p className={styles.financeValue}>{terms.deposit || '미확인'}</p>
              </div>
              {contractType === '월세' && (
                <div className={styles.financeStat}>
                  <p className={styles.financeLabel}>월세</p>
                  <p className={styles.financeValue}>{terms.monthly_rent || '미확인'}</p>
                </div>
              )}
              <div className={`${styles.financeStat} ${styles.financeStatWarn}`}>
                <p className={styles.financeLabel}>계약 기간</p>
                <p className={styles.financeValueWarn}>{period}</p>
              </div>
            </div>
            <div className={styles.ltvBar}>
              <div className={styles.ltvBarFill} style={{ width: `${riskPercent}%` }} />
            </div>
            <div className={styles.ltvScale}>
              <span>낮은 위험</span>
              <span>주의</span>
              <span className={styles.ltvScaleWarn}>높은 위험</span>
            </div>
            <div className={styles.infoNote}>
              <Info className={styles.infoNoteIcon} />
              <p>{analysis.summary}</p>
            </div>
          </section>

          <section className={styles.clauseCol}>
            <div className={styles.clauseHead}>
              <h3 className={styles.cardTitle}>계약 특약 사항 분석</h3>
              <div className={styles.legend}>
                <span className={styles.legendSafe}>
                  <i /> 낮음
                </span>
                <span className={styles.legendRisk}>
                  <i /> 주의
                </span>
              </div>
            </div>
            {clauses.map((clause) => {
              const ToneIcon = TONE_ICON[clause.tone]
              return (
                <article
                  key={`${clause.title}-${clause.quote}`}
                  className={`${styles.clauseCard} ${styles[`clause_${clause.tone}`]}`}
                >
                  <div className={styles.clauseTop}>
                    <h4>{clause.title}</h4>
                    <ToneIcon className={styles.clauseToneIcon} />
                  </div>
                  <p className={styles.clauseQuote}>&ldquo;{clause.quote}&rdquo;</p>
                  <p className={styles.clauseDetail}>
                    <strong>{clause.verdict}:</strong> {clause.detail}
                  </p>
                </article>
              )
            })}
          </section>

          <aside className={styles.actionCard}>
            <h3 className={styles.actionTitle}>
              <ClipboardCheck /> 권장 조치 사항
            </h3>
            <ul className={styles.actionList}>
              {actions.map((action, index) => (
                <li key={`${action.title}-${index}`}>
                  <span className={styles.actionNum}>{index + 1}</span>
                  <div>
                    <p className={styles.actionItemTitle}>{action.title}</p>
                    <p className={styles.actionItemDesc}>{action.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
            <Link to="/chat" className={styles.actionCta}>
              AI 어시스턴트에게 조언 구하기
            </Link>
          </aside>
        </div>

        <div className={styles.visualGrid}>
          <div className={styles.visualCard}>
            <div className={`${styles.visualArt} ${styles.visualArtBuilding}`}>
              {imageFailed ? (
                <Building className={styles.visualArtIcon} />
              ) : (
                <img
                  src={propertyImage}
                  alt={terms.property_type ?? '건물 이미지'}
                  className={styles.visualArtPhoto}
                  onError={() => setImageFailed(true)}
                />
              )}
            </div>
            <div className={styles.visualOverlay}>
              <p className={styles.visualOverlayTitle}>주거형태</p>
              <p className={styles.visualOverlayDesc}>{terms.property_type || '확인되지 않음'}</p>
            </div>
          </div>
          {/*
            지도 카드만 스크림이 **위**에 붙는다. 카카오는 하단 모서리에 로고와 출처 링크를
            그리고 약관상 가릴 수 없어서, 아래쪽 오버레이를 다시 넣으면 안 된다.
          */}
          <div className={styles.visualCard}>
            <div className={`${styles.visualArt} ${styles.visualArtMap}`}>
              <KakaoMap address={terms.address} />
            </div>
            <div className={styles.mapCaption}>
              <span className={styles.visualBadge}>위치 정보 분석</span>
              <p className={styles.mapAddress}>{terms.address || '위치 정보를 찾을 수 없습니다'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
