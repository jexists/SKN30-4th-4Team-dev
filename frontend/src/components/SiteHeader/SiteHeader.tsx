import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'

import { BRAND } from '../../config/env'
import { useAuth } from '../../hooks/useAuth'
import { Drawer } from '../Drawer/Drawer'
import { Bell, Clock, Menu, Shield } from '../icons'
import styles from './SiteHeader.module.scss'

const NAV = [
  { to: '/analyze', label: '계약 진단' },
  { to: '/risk-report', label: '위험 보고서' },
  { to: '/chat', label: 'AI 챗봇' },
]

export function SiteHeader() {
  const { isAuthed } = useAuth()
  const [navOpen, setNavOpen] = useState(false)
  // 드로어의 "이동하면 닫기" effect 의존성이 되므로 identity 를 고정한다.
  const closeNav = useCallback(() => setNavOpen(false), [])

  return (
    <header className={styles.siteHeader}>
      <div className={styles.headerInner}>
        {/* 좁은 화면에서 .nav 대신 서비스 이동을 담당한다(CSS 로 표시 전환). */}
        <button
          type="button"
          className={styles.menuBtn}
          aria-label="메뉴 열기"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          <Menu />
        </button>

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

        <MobileNavDrawer open={navOpen} onClose={closeNav} />

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

/**
 * 좁은 화면의 서비스 이동 드로어 — 데스크탑 .nav 와 같은 NAV 를 그린다.
 *
 * 설정·로그아웃·대화기록은 넣지 않는다. 이동은 여기, 계정은 헤더 우측 UserMenu,
 * AI 대화 관리는 챗 화면의 FAB 으로 역할을 나눠 둔다.
 */
function MobileNavDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation()

  // 뒤로가기 등 링크 클릭 외의 이동에도 닫는다.
  useEffect(() => {
    onClose()
  }, [pathname, onClose])

  return (
    <Drawer open={open} onClose={onClose} title="메뉴">
      <nav className={styles.drawerNav}>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive ? `${styles.drawerLink} ${styles.drawerLinkActive}` : styles.drawerLink
            }
            onClick={onClose}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </Drawer>
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
