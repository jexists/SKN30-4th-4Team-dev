import { Modal } from '../Modal/Modal'
import { dismissError, useAppError } from './errorModalStore'
import styles from './ErrorModalHost.module.scss'

/**
 * 전역 오류 모달 호스트. App 에 한 번 마운트한다.
 *
 * 모든 API 실패가 여기로 모인다(api/apiErrorHandler.ts). 본문은 서버 error.message 이고,
 * 추가 설명이 필요 없어 비어 있으면 제목만 보여준다.
 */
export function ErrorModalHost() {
  const error = useAppError()

  return (
    <Modal open={error !== null} onClose={dismissError} title={error?.title ?? '오류'}>
      {error?.message ? <p className={styles.message}>{error.message}</p> : null}
    </Modal>
  )
}
