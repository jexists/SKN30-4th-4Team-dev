import { Link } from 'react-router-dom'

import {
  ArrowRight,
  BarChart,
  Chat,
  Check,
  Edit,
  FileLines,
  User,
} from '../../components/icons'
import styles from './MyPage.module.scss'

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
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* 프로필 */}
        <section className={styles.profile}>
          <div className={styles.avatarWrap}>
            <div className={styles.avatar}>
              <User className={styles.avatarIcon} />
            </div>
            <Link to="/account" className={styles.avatarEdit} aria-label="계정 관리로 이동">
              <Edit />
            </Link>
          </div>
          <h1 className={styles.name}>
            김철수 <span className={styles.nameSuffix}>님</span>
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

        {/* 진행 중인 AI 상담 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>
            <Chat className={styles.sectionTitleIcon} /> 진행 중인 AI 상담
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
      </div>

      <Link to="/chat" className={styles.fab} aria-label="AI 챗봇 상담 시작하기">
        <Chat />
      </Link>
    </div>
  )
}
