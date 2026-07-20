import { NavLink } from 'react-router-dom'

import styles from './NavBar.module.scss'

const LINKS = [
  { to: '/', label: '홈' },
  { to: '/analyze', label: '분석' },
  { to: '/chat', label: '상담' },
  { to: '/mypage', label: '마이페이지' },
  { to: '/login', label: '로그인' },
]

export function NavBar() {
  return (
    <nav className={styles.navbar}>
      {LINKS.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.to === '/'}
          className={({ isActive }) => (isActive ? styles.active : undefined)}
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  )
}
