import { Link } from 'react-router-dom'

import { SiteFooter } from '../../components/SiteFooter/SiteFooter'
import { SiteHeader } from '../../components/SiteHeader/SiteHeader'
import { Chat, Compass, Doc, Grid, Refresh, Shield, Warn } from '../../components/icons'
import styles from './Home.module.scss'

const STATS = [
  { num: '68%', label: '첫 계약 임차인의 68%가 계약서의 사기 조항을 발견하지 못합니다.' },
  { num: '2.4조', label: '전세 및 임대 사기로 인한 연간 추정 금융 피해액.' },
  { num: '15초', label: '홈실드 AI가 계약서 전체를 스캔해 진단하는 데 걸리는 평균 시간.' },
]

const BENEFITS = [
  '실시간 소유주 등기 확인',
  "임차인의 권리를 제한하는 '독소 조항' 식별",
  '시장 시세 비교 (전세가율 분석)',
]

export function Home() {
  return (
    <div className={styles.page}>
      <SiteHeader />

      {/* ── 히어로 ── */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.heroLeft}>
            <span className={styles.badge}>
              <Shield className={styles.badgeMark} /> 안전 임대 가드
            </span>
            <h1 className={styles.heroTitle}>
              안전한 계약을 위한
              <br />
              법률 보호막.
            </h1>
            <p className={styles.heroDesc}>
              고급 OCR 진단과 RAG 기반 법률 AI를 통해 사기 계약과 불공정 특약으로부터
              임차인을 완벽하게 보호합니다.
            </p>
            <div className={styles.heroActions}>
              <Link to="/analyze" className={styles.btnPrimary}>
                <Doc /> 내 계약서 진단하기
              </Link>
              <Link to="/chat" className={styles.btnGhost}>
                <Refresh /> AI 챗봇 상담
              </Link>
            </div>
            <div className={styles.social}>
              <span className={styles.avatars} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              <p>
                최근 한 달간 <strong>2,030명의 임차인</strong>이 선택했습니다.
              </p>
            </div>
          </div>

          {/* 히어로 목업 카드 (사진 대신 CSS/SVG 목업) */}
          <div className={styles.heroRight}>
            <div className={styles.mockCard}>
              <div className={styles.mockDots} aria-hidden>
                <i />
                <i />
                <i />
              </div>
              <div className={`${styles.alertRow} ${styles.alertRisk}`}>
                <span className={styles.alertIcon}>
                  <Warn />
                </span>
                <div>
                  <b>고위험 탐지</b>
                  <p>제7조 2항: 보증금 반환 보호 조항 누락.</p>
                </div>
              </div>
              <div className={`${styles.alertRow} ${styles.alertSafe}`}>
                <span className={styles.alertIcon}>
                  <Shield />
                </span>
                <div>
                  <b>법적 안전</b>
                  <p>등기부등본상 소유주 확인 완료.</p>
                </div>
              </div>
              <div className={styles.mockScan} aria-hidden>
                <div className={styles.mockPaper}>
                  <span className={styles.mockPaperTitle}>주택 임대차 계약서</span>
                  <i />
                  <i />
                  <i className={styles.mockHi} />
                  <i />
                  <i style={{ width: '60%' }} />
                </div>
                <div className={styles.mockScanBar} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 다크 밴드: 통계 + 기능 소개 ── */}
      <section className={styles.darkBand}>
        <div className={styles.darkInner}>
          <h2 className={styles.bandHeading}>임대차 시장의 안전 공백</h2>
          <div className={styles.statGrid}>
            {STATS.map((s) => (
              <div key={s.num} className={styles.statCard}>
                <div className={styles.statNum}>{s.num}</div>
                <p className={styles.statLabel}>{s.label}</p>
              </div>
            ))}
          </div>

          <div className={styles.featureIntro}>
            <h3 className={styles.featureIntroTitle}>
              자동화된 분석,
              <br />
              전문가 수준의 정밀함.
            </h3>
            <p className={styles.featureIntroText}>
              독자적인 OCR 기술로 종이 계약서의 텍스트를 추출하고, RAG 기술을 통해
              최신 주택 임대차 법령과 대조하여 분석합니다.
            </p>
            <ul className={styles.checkList}>
              {BENEFITS.map((b) => (
                <li key={b}>
                  <span className={styles.check} aria-hidden>
                    ✓
                  </span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── 기능 카드 (벤토) ── */}
      <section className={styles.features}>
        <div className={styles.featuresInner}>
          <div className={styles.featuresHead}>
            <h2 className={styles.sectionTitle}>모든 임차인을 위한 기업급 보안 서비스</h2>
            <p className={styles.sectionSub}>복잡한 법률 용어를 이해하기 쉽게 풀어드립니다.</p>
          </div>

          <div className={styles.bento}>
            {/* OCR 진단 (큰 카드) */}
            <article className={`${styles.featCard} ${styles.featOcr}`}>
              <span className={`${styles.featIcon} ${styles.iconNavy}`}>
                <Doc />
              </span>
              <h3 className={styles.featTitle}>OCR 계약서 진단</h3>
              <p className={styles.featDesc}>
                종이 계약서 사진을 업로드하세요. AI가 몇 초 안에 텍스트를 스캔하고 추출하여
                고위험 영역을 강조해 보여줍니다.
              </p>
              <div className={styles.ocrScene} aria-hidden>
                <div className={styles.ocrPaper}>
                  <i />
                  <i />
                  <i className={styles.ocrHi} />
                  <i />
                </div>
                <div className={styles.ocrPhone} />
              </div>
            </article>

            {/* 안전 대시보드 */}
            <article className={`${styles.featCard} ${styles.featBlue}`}>
              <span className={`${styles.featIcon} ${styles.iconBlue}`}>
                <Grid />
              </span>
              <h3 className={styles.featTitle}>안전 대시보드</h3>
              <p className={styles.featDesc}>
                해당 매물의 안전 점수, 시장 동향, 인근 지역의 사기 의심 사례를 모니터링하세요.
              </p>
              <div className={styles.ring} aria-hidden>
                <svg viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" className={styles.ringTrack} />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    className={styles.ringFill}
                    strokeDasharray="314"
                    strokeDashoffset="25"
                  />
                </svg>
                <div className={styles.ringText}>
                  <b>92</b>
                  <span>안전 점수</span>
                </div>
              </div>
            </article>

            {/* AI 챗봇 (다크 카드) */}
            <article className={`${styles.featCard} ${styles.featDark}`}>
              <span className={`${styles.featIcon} ${styles.iconOnDark}`}>
                <Chat />
              </span>
              <h3 className={styles.featTitle}>법률 근거 AI 챗봇</h3>
              <p className={styles.featDesc}>
                임대차 계약에 대해 무엇이든 물어보세요. 실제 법조문과 판례에 기반한 답변을
                제공합니다.
              </p>
              <div className={styles.quoteChip}>
                <span className={styles.quoteSrc}>● 출처: 주택임대차보호법 제12조</span>
                <p>“보증금은 14일 이내에 에스크로 계좌에 예치되어야 합니다…”</p>
              </div>
            </article>

            {/* 전세가율 정밀 분석 */}
            <article className={`${styles.featCard} ${styles.featRatio}`}>
              <div className={styles.ratioText}>
                <span className={`${styles.featIcon} ${styles.iconNavy}`}>
                  <Compass />
                </span>
                <h3 className={styles.featTitle}>전세가율 정밀 분석</h3>
                <p className={styles.featDesc}>
                  매매가 대비 보증금 비율을 자동으로 계산하여 ‘깡통전세’ 위험을 사전에
                  방지합니다.
                </p>
                <Link to="/analyze" className={styles.inlineLink}>
                  위험 지표 알아보기 →
                </Link>
              </div>
              <div className={styles.arcGauge} aria-hidden>
                <svg viewBox="0 0 160 96">
                  <path d="M12 88 A68 68 0 0 1 148 88" className={styles.arcTrack} />
                  <path
                    d="M12 88 A68 68 0 0 1 148 88"
                    className={styles.arcFill}
                    strokeDasharray="214"
                    strokeDashoffset="60"
                  />
                  <line x1="80" y1="88" x2="112" y2="44" className={styles.arcNeedle} />
                  <circle cx="80" cy="88" r="5" className={styles.arcHub} />
                </svg>
                <div className={styles.arcLabel}>
                  <b>74% 전세가율</b>
                  <span>주의 단계 (중간 위험)</span>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* ── 하단 CTA ── */}
      <section className={styles.finalCta}>
        <div className={styles.finalInner}>
          <h2 className={styles.finalTitle}>안전장치 없이 서명하지 마세요.</h2>
          <p className={styles.finalSub}>
            이번 달에만 수천 명의 현명한 임차인들이 홈실드와 함께 안전하게 계약했습니다.
          </p>
          <div className={styles.finalActions}>
            <Link to="/analyze" className={styles.btnPrimary}>
              지금 바로 계약서 점검하기
            </Link>
            <Link to="/chat" className={styles.btnOutline}>
              데모 보기
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}
