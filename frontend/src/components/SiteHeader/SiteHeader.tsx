import { Link, NavLink } from 'react-router-dom'

import { Bell, Clock, Shield } from '../icons'
import styles from './SiteHeader.module.scss'

const NAV = [
  { to: '/analyze', label: '계약 진단' },
  { to: '/chat', label: 'AI 챗봇' },
  { to: '/mypage', label: '위험 보고서' },
]

export function SiteHeader() {
  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        <Link to="/" className={styles.brand}>
          <Shield className={styles.brandMark} />
          <span>HomeShield</span>
        </Link>
        <nav className={styles.nav}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? `${styles.navLink} ${styles.navActive}` : styles.navLink
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.headerRight}>
          <button className={styles.iconBtn} aria-label="최근 기록">
            <Clock />
          </button>
          <button className={styles.iconBtn} aria-label="알림">
            <Bell />
          </button>
          <Link to="/chat" className={styles.ctaSm}>
            상담 시작하기
          </Link>
          <Link to="/mypage" className={styles.avatar} aria-label="마이페이지" />
        </div>
      </div>
    </header>
  )
}
