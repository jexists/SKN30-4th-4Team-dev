import { Link, useLocation } from 'react-router-dom'

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
import type { DocumentAnalysisResult, RiskSeverity } from '../../types/document'
import styles from './RiskReport.module.scss'

type ClauseTone = 'risk' | 'safe' | 'neutral'

type Clause = {
  tone: ClauseTone
  title: string
  quote: string
  verdict: string
  detail: string
}

const SAMPLE_CLAUSES: Clause[] = [
  {
    tone: 'risk',
    title: '수선 및 유지보수 책임',
    quote: '임차인은 임대차 기간 중 구조적 문제를 포함한 모든 유지보수 및 수리 책임을 진다.',
    verdict: '불리',
    detail: '주요 구조물에 대한 수선 의무를 임차인에게 전가하는 조항인지 확인해야 합니다.',
  },
  {
    tone: 'safe',
    title: '선순위 권리 유지',
    quote: '임차인의 대항력 취득 전까지 추가 담보권을 설정하지 않는다.',
    verdict: '유리',
    detail: '임차인의 보증금 변제 우선순위를 보호하는 조항입니다.',
  },
]

const SAMPLE_ACTIONS = [
  { title: '특약 협상', desc: '불리한 수선 책임 조항의 범위를 임대인과 다시 협의하세요.' },
  { title: '체납 사실 확인', desc: '국세 및 지방세 완납증명서를 요청하세요.' },
  { title: '보증보험 확인', desc: '전세보증금 반환보증 가입 가능 여부를 확인하세요.' },
]

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

type ReportLocationState = { documentAnalysis?: DocumentAnalysisResult }

function downloadMaskedPdf(result: DocumentAnalysisResult) {
  const binary = window.atob(result.masked_pdf_base64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: result.masked_pdf_media_type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'masked-contract.pdf'
  anchor.click()
  URL.revokeObjectURL(url)
}

export function RiskReport() {
  const location = useLocation()
  const result = (location.state as ReportLocationState | null)?.documentAnalysis
  const analysis = result?.analysis
  const terms = analysis?.terms

  const analyzedClauses: Clause[] =
    analysis?.risks.map((risk) => ({
      tone: SEVERITY_TONE[risk.severity],
      title: risk.title,
      quote: risk.clause || '계약서 전체 문맥을 기준으로 검토한 항목입니다.',
      verdict:
        risk.severity === 'HIGH' ? '고위험' : risk.severity === 'MEDIUM' ? '주의' : '낮음',
      detail: risk.reason,
    })) ?? []
  const clauses = analyzedClauses.length
    ? analyzedClauses
    : result
      ? [
          {
            tone: 'safe' as const,
            title: '명시적인 고위험 조항 없음',
            quote: '자동 분석에서 즉시 경고할 계약 조항을 찾지 못했습니다.',
            verdict: '확인',
            detail: '등기부등본과 실제 권리관계는 별도로 확인해야 합니다.',
          },
        ]
      : SAMPLE_CLAUSES
  const actions = analysis
    ? analysis.risks.length
      ? analysis.risks.map((risk) => ({ title: risk.title, desc: risk.recommendation }))
      : [
          {
            title: '권리관계 별도 확인',
            desc: '자동 분석에서 고위험 조항은 없었지만 최신 등기부등본과 체납 여부를 확인하세요.',
          },
        ]
    : SAMPLE_ACTIONS
  const highCount = analysis?.risks.filter((risk) => risk.severity === 'HIGH').length ?? 1
  const mediumCount = analysis?.risks.filter((risk) => risk.severity === 'MEDIUM').length ?? 1
  const lowCount = analysis?.risks.filter((risk) => risk.severity === 'LOW').length ?? 0
  const score = result ? Math.max(20, 100 - highCount * 25 - mediumCount * 12 - lowCount * 4) : 72
  const scoreLabel = score >= 80 ? '안전' : score >= 60 ? '주의' : '위험'
  const riskPercent = 100 - score
  const period = [terms?.contract_start, terms?.contract_end].filter(Boolean).join(' ~ ') || '미확인'

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>종합 리스크 리포트</h1>
            <p className={styles.subtitle}>
              {analysis
                ? `계약 유형: ${terms?.property_type || '주택 임대차계약서'}`
                : '계약서를 업로드하면 실제 분석 결과가 이 화면에 표시됩니다.'}
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.btnOutline}
              disabled={!result}
              onClick={() => result && downloadMaskedPdf(result)}
            >
              <Download /> PDF 다운로드
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => {
                const text = analysis?.summary || '종합 리스크 리포트'
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
            <p className={styles.scoreDesc}>
              {analysis?.summary || '계약서를 업로드하면 OCR로 인식한 조항을 기준으로 분석합니다.'}
            </p>
          </section>

          <section className={styles.financeCard}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>주요 계약 조건</h3>
              <span className={styles.warnPill}>{analysis ? `${highCount}개 고위험 항목` : '분석 전'}</span>
            </div>
            <div className={styles.financeGrid}>
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>보증금</p>
                <p className={styles.financeValue}>{terms?.deposit || '미확인'}</p>
              </div>
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>월세</p>
                <p className={styles.financeValue}>{terms?.monthly_rent || '미확인'}</p>
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
              <p>{analysis?.summary || '계약서 분석을 시작하려면 분석 화면에서 파일을 선택하세요.'}</p>
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
              <Building className={styles.visualArtIcon} />
            </div>
            <div className={styles.visualOverlay}>
              <p className={styles.visualOverlayTitle}>개인정보 보호 결과</p>
              <p className={styles.visualOverlayDesc}>
                {result
                  ? `개인정보 ${result.mask_count}개를 마스킹했습니다.${result.review_required ? ' 결과를 사람이 한 번 더 확인하는 것을 권장합니다.' : ''}`
                  : '분석 시 개인정보를 마스킹한 PDF를 함께 생성합니다.'}
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
