import { Outlet } from 'react-router-dom'

import { HealthStatus } from './components/HealthStatus/HealthStatus'
import { NavBar } from './components/NavBar/NavBar'
import styles from './App.module.scss'

export default function App() {
  return (
    <div className={styles.layout}>
      <NavBar />
      <main className={styles.main}>
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <HealthStatus />
      </footer>
    </div>
  )
}
