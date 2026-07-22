import { Link } from 'react-router-dom'

import { Shield } from '../icons'
import styles from './SiteFooter.module.scss'

export function SiteFooter() {
  return (
    <footer className={styles.siteFooter}>
      <div className={styles.footerInner}>
        <div className={styles.footerBrand}>
          <div className={styles.brand}>
            <Shield className={styles.brandMark} />
            <span>HomeShield</span>
          </div>
          <p>
            © 2024 HomeShield Legal Tech. 본 서비스는 자동화된 분석 결과를 제공하며, 법적 자문을
            대신하지 않습니다.
          </p>
        </div>
        <nav className={styles.footerLinks}>
          <Link to="/terms">이용약관</Link>
          <Link to="/privacy">개인정보처리방침</Link>
          <Link to="/terms">법적 고지</Link>
          <Link to="/mypage">고객지원</Link>
        </nav>
      </div>
    </footer>
  )
}
