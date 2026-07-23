import { Link, useNavigate } from 'react-router-dom'

import { ArrowLeft, Home } from '../../components/icons'
import styles from './NotFound.module.scss'

export function NotFound() {
  const navigate = useNavigate()

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <h1 className={styles.title}>페이지를 찾을 수 없습니다</h1>
        <p className={styles.desc}>
          요청하신 페이지의 주소가 잘못 입력되었거나,
          <br />
          페이지가 삭제되어 더 이상 찾을 수 없습니다.
        </p>
        <div className={styles.actions}>
          <Link to="/" className={styles.btnPrimary}>
            <Home /> 홈으로 돌아가기
          </Link>
          <button type="button" className={styles.btnOutline} onClick={() => navigate(-1)}>
            <ArrowLeft /> 이전 페이지로
          </button>
        </div>
      </div>
    </div>
  )
}
