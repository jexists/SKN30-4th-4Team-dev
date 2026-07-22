import { Link } from 'react-router-dom'

import { BRAND, BRAND_LEGAL_NAME } from '../../config/env'
import { Shield } from '../icons'
import styles from './SiteFooter.module.scss'

const LINKS = [
  { to: '/terms', label: '이용약관' },
  { to: '/privacy', label: '개인정보처리방침' },
  { to: '/terms', label: '법적 고지' },
  { to: '/mypage', label: '고객지원' },
]

const DISCLAIMER = '본 서비스는 자동화된 분석 결과를 제공하며, 법적 자문을 대신하지 않습니다.'

type SiteFooterProps = {
  /**
   * full — 랜딩을 닫는 다크 밴드. 마케팅 흐름의 마지막 선언 자리.
   * compact — 로그인·마이페이지처럼 화면 자체가 주인공인 작업 화면용 한 줄 고지 스트립.
   */
  variant?: 'full' | 'compact'
}

export function SiteFooter({ variant = 'full' }: SiteFooterProps) {
  if (variant === 'compact') {
    return (
      <footer className={styles.compact}>
        <div className={styles.compactInner}>
          {/* 브랜드 워드마크는 헤더와 중복이라 생략하고, 법적 고지만 남긴다. */}
          <p className={styles.compactLegal}>
            <Shield className={styles.compactMark} />
            <span>
              © 2024 {BRAND_LEGAL_NAME} · {DISCLAIMER}
            </span>
          </p>
          <nav className={styles.compactLinks}>
            {LINKS.map((link) => (
              <Link key={link.label} to={link.to}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    )
  }

  return (
    <footer className={styles.siteFooter}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <div className={styles.brand}>
            <Shield className={styles.brandMark} />
            <span>{BRAND.name}</span>
          </div>
          <p>
            © 2024 {BRAND_LEGAL_NAME}. {DISCLAIMER}
          </p>
        </div>
        <nav className={styles.footerLinks}>
          {LINKS.map((link) => (
            <Link key={link.label} to={link.to}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
