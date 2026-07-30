import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'

import apartmentImg from '../../../assets/images/apartment.png'
import officetelImg from '../../../assets/images/efficiency_apartment.png'
import houseImg from '../../../assets/images/house.png'
import villaImg from '../../../assets/images/multiplex_housing.png'
import { getAnalysis, listAnalyses } from '../../api/analyses'
import { isRetryable } from '../../api/apiErrorHandler'
import { ErrorState } from '../../components/ErrorState/ErrorState'
import {
  Building,
  Check,
  ClipboardCheck,
  Download,
  Info,
  Pin,
  Share,
  Warn,
} from '../../components/icons'
import {
  markAnalysisFinished,
  markResourceNotificationsRead,
} from '../../hooks/useNotifications'
import type {
  AnalysisJobDetail,
  AnalysisResult,
  AnalysisStage,
} from '../../types/analysis'
import { isTerminal } from '../../types/analysis'
import type { RiskSeverity } from '../../types/document'
import styles from './RiskReport.module.scss'

/**
 * 종합 리스크 리포트.
 *
 * 예전엔 `location.state` 로 결과를 받아 **새로고침하면 사라졌다.** 지금은 URL 의 jobId 가
 * 유일한 입력이고 결과는 서버에 있다 — 링크를 공유하거나 알림에서 들어와도 같은 화면이 뜬다.
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
  // 헤더의 "위험 보고서" 내비는 id 없이 들어온다 — 가장 최근 결과로 보낸다.
  return jobId ? <JobReport jobId={jobId} /> : <LatestReportRedirect />
}

// ── /risk-report (id 없음) ─────────────────────────────────────────────

function LatestReportRedirect() {
  const navigate = useNavigate()
  const [latestId, setLatestId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'empty' | 'error'>('loading')
  const [error, setError] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    listAnalyses(null, 20)
      .then((page) => {
        if (cancelled) return
        const newest = page.items.find((item) => item.status === 'SUCCEEDED')
        if (newest) setLatestId(newest.id)
        else setStatus('empty')
      })
      .catch((caught) => {
        if (cancelled) return
        setError(caught)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  if (latestId) return <Navigate replace to={`/risk-report/${latestId}`} />

  if (status === 'error') {
    return (
      <CenteredPanel>
        <ErrorState
          variant="plain"
          message="분석 기록을 불러오지 못했습니다."
          onRetry={isRetryable(error) ? () => setReloadKey((key) => key + 1) : undefined}
          action={{ label: '분석하러 가기', onClick: () => navigate('/analyze') }}
        />
      </CenteredPanel>
    )
  }

  if (status === 'empty') {
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

  return <LoadingPanel label="최근 분석 결과를 찾고 있습니다" />
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
    <div className={styles.page}>
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
  const label = job.stage ? (STAGE_LABEL[job.stage] ?? '분석을 진행하고 있습니다') : '분석을 준비하고 있습니다'
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
  const propertyImage = terms.property_type ? PROPERTY_TYPE_IMAGE[terms.property_type] : undefined

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

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>종합 리스크 리포트</h1>
            <p className={styles.subtitle}>
              계약 유형: {terms.property_type || '주택 임대차계약서'}
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
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => {
                const text = analysis.summary || '종합 리스크 리포트'
                if (navigator.share) void navigator.share({ title: '종합 리스크 리포트', text })
                else void navigator.clipboard.writeText(text)
              }}
            >
              <Share /> 리포트 공유
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
            <div className={styles.financeGrid}>
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>보증금</p>
                <p className={styles.financeValue}>{terms.deposit || '미확인'}</p>
              </div>
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>월세</p>
                <p className={styles.financeValue}>{terms.monthly_rent || '미확인'}</p>
              </div>
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
                <span className={styles.legendSafe}><i /> 낮음</span>
                <span className={styles.legendRisk}><i /> 주의</span>
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
            <h3 className={styles.actionTitle}><ClipboardCheck /> 권장 조치 사항</h3>
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
            <Link to="/chat" className={styles.actionCta}>AI 어시스턴트에게 조언 구하기</Link>
          </aside>
        </div>

        <div className={styles.visualGrid}>
          <div className={styles.visualCard}>
            <div className={`${styles.visualArt} ${styles.visualArtBuilding}`}>
              {propertyImage ? (
                <img src={propertyImage} alt={terms.property_type ?? ''} className={styles.visualArtPhoto} />
              ) : (
                <Building className={styles.visualArtIcon} />
              )}
            </div>
            <div className={styles.visualOverlay}>
              <p className={styles.visualOverlayTitle}>개인정보 보호 결과</p>
              <p className={styles.visualOverlayDesc}>
                개인정보 {result.mask_count}개를 마스킹했습니다.
                {result.review_required ? ' 결과를 사람이 한 번 더 확인하는 것을 권장합니다.' : ''}
              </p>
            </div>
          </div>
          <div className={styles.visualCard}>
            <div className={`${styles.visualArt} ${styles.visualArtMap}`}>
              <Pin className={styles.visualArtIcon} />
            </div>
            <span className={styles.visualBadge}>위치 정보 분석</span>
          </div>
        </div>
      </div>
    </div>
  )
}
