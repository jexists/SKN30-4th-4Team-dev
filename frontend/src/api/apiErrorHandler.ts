import { showError } from '../components/ErrorModal/errorModalStore'
import { ApiError } from './apiError'

/**
 * API 실패를 어떻게 보여줄지 정하는 **유일한 지점**.
 *
 * 화면은 "실패했다"는 사실만 알면 되고, 문구·표시 방식은 여기서 결정한다. 새 화면을
 * 추가해도 client.ts 를 거치는 한 같은 동작을 얻는다.
 */
export function reportApiFailure(error: unknown): void {
  if (error instanceof ApiError) {
    // 401 은 client.ts 가 세션을 정리하고 로그인 화면으로 보내는 중이다.
    // 여기서 모달까지 띄우면 로그인 화면 위에 겹치고, 앱 시작 시 병렬 401 이면 원인을
    // 오해하게 만든다.
    if (error.code === 401) return

    // 문구는 전부 서버가 준 것을 쓴다 — 프론트가 상태 코드별 문구를 따로 갖지 않는다.
    showError(error.title, error.message)
    return
  }

  // ApiError 가 아니면 응답 자체를 못 받은 것이다(fetch 의 TypeError, 비 JSON 응답 등).
  showError('네트워크 오류', '인터넷 연결을 확인한 뒤 다시 시도해 주세요.')
}

/**
 * 같은 요청을 다시 보내면 성공할 여지가 있는가 = 화면에 "다시 시도" 를 보일 것인가.
 *
 * 이 판단도 화면이 아니라 여기서 한다 — 404·403 에 재시도 버튼을 주면 사용자가 같은
 * 실패를 반복하게 된다. <ErrorState onRetry> 를 줄지 정할 때 쓴다.
 */
export function isRetryable(error: unknown): boolean {
  // 서버 장애는 잠시 뒤 풀릴 수 있다. 그 밖의 4xx 는 다시 보내도 결과가 같다.
  if (error instanceof ApiError) return error.code >= 500
  // 응답 자체를 못 받은 경우(네트워크)는 다시 시도할 가치가 있다.
  return true
}
