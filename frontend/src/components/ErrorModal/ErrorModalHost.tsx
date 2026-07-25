import { Modal } from '../Modal/Modal'
import { dismissError, useAppError } from './errorModalStore'

/**
 * 전역 오류 모달 호스트. App 에 한 번 마운트한다.
 * showError(title, message) 가 호출되면 공통 Modal 로 error 타이틀 + 메시지를 보여준다.
 */
export function ErrorModalHost() {
  const error = useAppError()

  return (
    <Modal open={error !== null} onClose={dismissError} title={error?.title ?? '오류'}>
      {error?.message}
    </Modal>
  )
}
