import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'

import { BRAND } from '../../config/env'
import { useAuth } from '../../hooks/useAuth'
import { Bell, Clock, Shield } from '../icons'
import styles from './SiteHeader.module.scss'

const NAV = [
  { to: '/analyze', label: '계약 진단' },
  { to: '/chat', label: 'AI 챗봇' },
  { to: '/risk-report', label: '위험 보고서' },
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
    // 보호된 화면(RequireAuth)에서 로그아웃하면 SPA 내 navigate('/') 는 라우터가
    // 위치를 갱신하기 전에 가드가 먼저 인증 해제를 감지해 /login 으로 보내버리는
    // 경합이 생긴다. 전체 새로고침으로 이동하면 앱이 처음부터 다시 마운트되며
    // 이미 지워진 토큰으로 시작하므로 이 경합 자체가 발생하지 않는다.
    window.location.href = '/'
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
          <Link
            to="/account"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => setOpen(false)}
          >
            계정 관리
          </Link>
          <button type="button" role="menuitem" className={styles.menuItem} onClick={handleSignOut}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}
