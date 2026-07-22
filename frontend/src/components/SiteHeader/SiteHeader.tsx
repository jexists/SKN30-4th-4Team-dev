import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'

import { BRAND } from '../../config/env'
import { useAuth } from '../../hooks/useAuth'
import { Bell, Clock, Shield } from '../icons'
import styles from './SiteHeader.module.scss'

const NAV = [
  { to: '/analyze', label: '계약 진단' },
  { to: '/chat', label: 'AI 챗봇' },
  { to: '/mypage', label: '위험 보고서' },
]

export function SiteHeader() {
  const { isAuthed } = useAuth()

  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        <Link to="/" className={styles.brand}>
          <Shield className={styles.brandMark} />
          <span>{BRAND.name}</span>
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
          {/* 최근 기록·알림은 개인화 기능이라 로그인 상태에서만 노출한다. */}
          {isAuthed && (
            <>
              <button className={styles.iconBtn} aria-label="최근 기록">
                <Clock />
              </button>
              <button className={styles.iconBtn} aria-label="알림">
                <Bell />
              </button>
            </>
          )}
          <Link to="/chat" className={styles.ctaSm}>
            상담 시작하기
          </Link>
          {isAuthed ? (
            <UserMenu />
          ) : (
            <Link to="/login" className={styles.loginBtn}>
              로그인
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}

/** 아바타 클릭 시 열리는 계정 메뉴 (마이페이지·로그아웃). */
function UserMenu() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: PointerEvent) {
      // 메뉴 바깥을 누르면 닫는다.
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function handleSignOut() {
    setOpen(false)
    signOut()
    // 로그아웃 후에는 보호된 화면 대신 홈으로 보낸다.
    void navigate('/')
  }

  return (
    <div className={styles.userMenu} ref={rootRef}>
      <button
        type="button"
        className={styles.avatar}
        aria-label="내 계정"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      />
      {open && (
        <div className={styles.menu} role="menu">
          <Link
            to="/mypage"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => setOpen(false)}
          >
            마이페이지
          </Link>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={handleSignOut}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}
