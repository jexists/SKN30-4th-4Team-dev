import { Outlet, useLocation } from 'react-router-dom'

import { ErrorModalHost } from './components/ErrorModal/ErrorModalHost'
import { HealthStatus } from './components/HealthStatus/HealthStatus'
import { SiteFooter } from './components/SiteFooter/SiteFooter'
import { SiteHeader } from './components/SiteHeader/SiteHeader'
import { Toaster } from './components/Toast/Toaster'
import { ENV } from './config/env'
import styles from './App.module.scss'

export default function App() {
  const { pathname } = useLocation()
  // 채팅은 화면 높이를 그대로 쓰는 앱 셸이라 푸터를 붙이지 않는다.
  const isChat = pathname === '/chat' || pathname.startsWith('/chat/')
  // 랜딩만 다크 밴드로 닫고, 나머지 화면은 한 줄 고지 스트립으로 마무리한다.
  const isLanding = pathname === '/'
  // 자체 디자인으로 화면을 꽉 채우는 화면 — 공통 여백을 주지 않는다.
  const isFullBleed =
    isLanding ||
    isChat ||
    pathname === '/analyze' ||
    pathname === '/login' ||
    pathname === '/support' ||
    pathname === '/mypage' ||
    pathname === '/risk-report'

  return (
    <div className={isChat ? `${styles.layout} ${styles.chatLayout}` : styles.layout}>
      <SiteHeader />
      <main className={isFullBleed ? styles.fullMain : styles.main}>
        <Outlet />
      </main>
      {!isChat && <SiteFooter variant={isLanding ? 'full' : 'compact'} />}
      <Toaster />
      <ErrorModalHost />
      {/* 백엔드 연결 표시는 로컬 개발 서버에서만 좌하단에 띄운다. 빌드 결과물에는 포함되지 않는다. */}
      {ENV.isDev && (
        <div className={styles.devStatus}>
          <HealthStatus />
        </div>
      )}
    </div>
  )
}
