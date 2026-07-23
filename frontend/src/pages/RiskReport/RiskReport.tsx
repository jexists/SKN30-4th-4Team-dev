import { Link } from 'react-router-dom'

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
import styles from './RiskReport.module.scss'

type ClauseTone = 'risk' | 'safe' | 'neutral'

type Clause = {
  tone: ClauseTone
  title: string
  quote: string
  verdict: string
  detail: string
}

const CLAUSES: Clause[] = [
  {
    tone: 'risk',
    title: '수선 및 유지보수 책임',
    quote: '임차인은 임대차 기간 중 구조적 문제를 포함한 모든 유지보수 및 수리 책임을 진다.',
    verdict: '불리',
    detail:
      '주요 구조물에 대한 수선 의무는 임대인에게 있다는 민법 원칙에서 벗어난 조항입니다. 예상치 못한 큰 비용이 발생할 수 있습니다.',
  },
  {
    tone: 'safe',
    title: '선순위 권리 유지',
    quote:
      '임대인은 임차인이 입주하고 전입신고를 마친 다음 날까지 추가적인 근저당권이나 담보권을 설정하지 않는다.',
    verdict: '유리',
    detail:
      '임차인의 대항력 확보 및 보증금 변제 우선순위를 보호하는 조항입니다. 매우 권장되는 방어적 특약입니다.',
  },
  {
    tone: 'neutral',
    title: '계약 갱신 및 해지',
    quote: '임차인은 1회에 한하여 계약갱신요구권을 행사할 수 있으며, 이 경우 임대차 기간은 2년 연장된다.',
    verdict: '표준',
    detail: '주택임대차보호법의 내용과 부합합니다. 별도의 조치는 필요하지 않습니다.',
  },
]

const ACTIONS = [
  {
    title: '특약 4번 협상',
    desc: '구조물이나 주요 설비를 제외한 "소모성 자재"로 수선 책임을 한정하도록 임대인과 협상하십시오.',
  },
  {
    title: '체납 사실 확인',
    desc: '국세 및 지방세 완납증명서를 요청하여 숨겨진 조세채권 리스크가 없는지 반드시 확인하십시오.',
  },
  {
    title: 'HUG 전세보증보험',
    desc: '높은 전세가율(84%)을 고려할 때, 입주 즉시 HUG 전세보증금 반환보증 가입을 강력히 권장합니다.',
  },
]

const TONE_ICON: Record<ClauseTone, typeof Warn> = {
  risk: Warn,
  safe: Check,
  neutral: Info,
}

export function RiskReport() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>종합 리스크 리포트</h1>
            <p className={styles.subtitle}>
              매물 정보: 서울특별시 서초구 서초동 1303-34, 럭셔리하이츠 402호
            </p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.btnOutline}>
              <Download /> PDF 다운로드
            </button>
            <button type="button" className={styles.btnPrimary}>
              <Share /> 리포트 공유
            </button>
          </div>
        </header>

        <div className={styles.bento}>
          {/* 종합 안전 점수 */}
          <section className={styles.scoreCard}>
            <h3 className={styles.cardTitle}>종합 안전 점수</h3>
            <div className={styles.gauge}>
              <svg className={styles.gaugeSvg} viewBox="0 0 100 100">
                <circle className={styles.gaugeTrack} cx="50" cy="50" r="45" />
                <circle className={styles.gaugeFill} cx="50" cy="50" r="45" strokeDasharray="283" strokeDashoffset="80" />
              </svg>
              <div className={styles.gaugeText}>
                <span className={styles.gaugeNum}>72</span>
                <span className={styles.gaugeLabel}>주의</span>
              </div>
            </div>
            <p className={styles.scoreDesc}>
              본 매물은 시장가 대비 높은 전세가율로 인해 <b>주의 단계</b>의 리스크를 보유하고
              있습니다.
            </p>
          </section>

          {/* 재무 건전성 분석 */}
          <section className={styles.financeCard}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>재무 건전성 분석</h3>
              <span className={styles.warnPill}>고위험 전세가율 주의</span>
            </div>
            <div className={styles.financeGrid}>
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>매매 시세 (추정)</p>
                <p className={styles.financeValue}>₩850,000,000</p>
              </div>
              <div className={styles.financeStat}>
                <p className={styles.financeLabel}>선순위 채권</p>
                <p className={styles.financeValue}>₩240,000,000</p>
              </div>
              <div className={`${styles.financeStat} ${styles.financeStatWarn}`}>
                <p className={styles.financeLabel}>부채비율 (전세가율)</p>
                <p className={styles.financeValueWarn}>84.2%</p>
              </div>
            </div>
            <div className={styles.ltvBar}>
              <div className={styles.ltvBarFill} style={{ width: '84.2%' }} />
            </div>
            <div className={styles.ltvScale}>
              <span>안전 (70% 미만)</span>
              <span>보통 (70-80%)</span>
              <span className={styles.ltvScaleWarn}>주의 (80% 초과)</span>
            </div>
            <div className={styles.infoNote}>
              <Info className={styles.infoNoteIcon} />
              <p>
                보증금과 선순위 채권의 합계액이 매매 시세의 80%를 초과합니다. 경매 진행 시 보증금
                전액 회수가 어려울 수 있는 위험이 있습니다.
              </p>
            </div>
          </section>

          {/* 계약 특약 사항 분석 */}
          <section className={styles.clauseCol}>
            <div className={styles.clauseHead}>
              <h3 className={styles.cardTitle}>계약 특약 사항 분석</h3>
              <div className={styles.legend}>
                <span className={styles.legendSafe}>
                  <i /> 유리
                </span>
                <span className={styles.legendRisk}>
                  <i /> 주의
                </span>
              </div>
            </div>
            {CLAUSES.map((clause) => {
              const ToneIcon = TONE_ICON[clause.tone]
              return (
                <article
                  key={clause.title}
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

          {/* 권장 조치 사항 */}
          <aside className={styles.actionCard}>
            <h3 className={styles.actionTitle}>
              <ClipboardCheck /> 권장 조치 사항
            </h3>
            <ul className={styles.actionList}>
              {ACTIONS.map((action, i) => (
                <li key={action.title}>
                  <span className={styles.actionNum}>{i + 1}</span>
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

        {/* 시각적 컨텍스트 */}
        <div className={styles.visualGrid}>
          <div className={styles.visualCard}>
            <div className={`${styles.visualArt} ${styles.visualArtBuilding}`}>
              <Building className={styles.visualArtIcon} />
            </div>
            <div className={styles.visualOverlay}>
              <p className={styles.visualOverlayTitle}>건물 상태 정보</p>
              <p className={styles.visualOverlayDesc}>
                2019년 준공된 고급 주거 단지입니다. 건축물대장상 위반 건축물 내역이 없습니다.
              </p>
            </div>
          </div>
          <div className={styles.visualCard}>
            <div className={`${styles.visualArt} ${styles.visualArtMap}`}>
              <Pin className={styles.visualArtIcon} />
            </div>
            <span className={styles.visualBadge}>위치 정보 분석</span>
            <div className={styles.visualNote}>
              <p className={styles.visualNoteTitle}>주변 환경 안전성</p>
              <p className={styles.visualNoteDesc}>
                낮은 범죄율 및 역세권(300m 이내) 위치로 보증금 회수를 위한 환금성이 우수합니다.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
