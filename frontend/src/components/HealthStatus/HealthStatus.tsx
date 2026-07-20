import { useHealth } from '../../hooks/useHealth'
import styles from './HealthStatus.module.scss'

const LABEL: Record<string, string> = {
  loading: '백엔드 연결 확인 중…',
  ok: '백엔드 연결됨',
  error: '백엔드 연결 실패',
}

export function HealthStatus() {
  const { status } = useHealth()

  return (
    <div className={styles.healthStatus} data-status={status}>
      <span className={styles.dot} />
      {LABEL[status]}
    </div>
  )
}
