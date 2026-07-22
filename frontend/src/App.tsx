import { Outlet, useLocation } from 'react-router-dom'

import { HealthStatus } from './components/HealthStatus/HealthStatus'
import { NavBar } from './components/NavBar/NavBar'
import styles from './App.module.scss'

export default function App() {
  const { pathname } = useLocation()
  // HomeShield 자체 헤더·푸터를 가진 화면은 공통 크롬(NavBar/footer)을 숨긴다.
  const isLanding =
    pathname === '/' ||
    pathname === '/analyze' ||
    pathname === '/chat' ||
    pathname.startsWith('/chat/')

  return (
    <div className={styles.layout}>
      {!isLanding && <NavBar />}
      <main className={isLanding ? styles.landingMain : styles.main}>
        <Outlet />
      </main>
      {!isLanding && (
        <footer className={styles.footer}>
          <HealthStatus />
        </footer>
      )}
    </div>
  )
}
