import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { BRAND } from '../../config/env'
import { useAuth } from '../../hooks/useAuth'
import { Bell, Clock, Shield } from '../icons'
import styles from './SiteHeader.module.scss'

const NAV = [
  { to: '/analyze', label: '계약 진단' },
  { to: '/risk-report', label: '위험 보고서' },
  { to: '/chat', label: 'AI 챗봇' },
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

          {/* <Link to="/chat" className={styles.ctaSm}>
            상담 시작하기
          </Link> */}

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
  const location = useLocation()

  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 로그아웃은 "홈으로 이동 → 그다음 세션 삭제" 순서로 처리한다.
  // 세션을 먼저 지우면 보호 화면에선 RequireAuth가 /login으로 가로챈다.
  useEffect(() => {
    if (signingOut && location.pathname === '/') {
      signOut()
      setSigningOut(false)
    }
  }, [signingOut, location.pathname, signOut])

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
      }
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
    setSigningOut(true)
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

          <Link
            to="/account"
            role="menuitem"
            className={styles.menuItem}
            onClick={() => setOpen(false)}
          >
            계정 관리
          </Link>

          <button
            type="button"
            role="menuitem"
            className={styles.menuItem}
            onClick={handleSignOut}
          >
            로그아웃
          </button>
        </div>
      )}
    </div>
  )
}
