import { showToast } from '../components/Toast/toastStore'
import { ENV } from '../config/env'
import { supabase } from '../config/supabase'
import { expireSession } from '../hooks/useAuth'
import type { ApiResponse } from '../types/api'
import { ApiError } from './apiError'
import { reportApiFailure } from './apiErrorHandler'

// 화면 코드가 예전 경로(`from '../../api/client'`) 그대로 쓸 수 있게 다시 내보낸다.
export { ApiError }

const BASE_URL = ENV.apiBaseUrl

/**
 * Supabase 세션의 '현재' 액세스 토큰. 없거나 읽기에 실패하면 null.
 *
 * getSession 은 만료가 임박하면 자동으로 갱신하므로, localStorage 에 복사해 둔
 * 토큰(만료됐을 수 있음)보다 안전하다. 다만 갱신이 실패해도 error 만 돌려주고
 * 옛 세션을 그대로 넘길 때가 있어, 이것만으로는 유효성을 보장하지 못한다.
 * 최종 판단은 서버의 401 이다 — 아래 request 참고.
 */
async function currentToken(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) return null
  return data.session?.access_token ?? null
}

/** 세션을 강제로 한 번 갱신한다. 성공하면 새 액세스 토큰, 실패하면 null. */
async function renewToken(): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.refreshSession()
  if (error) return null
  return data.session?.access_token ?? null
}

function authHeader(token: string | null): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** 봉투에서 data 를 꺼낸다. 실패거나 data 가 비면 ApiError. title/message 는 모달에 그대로 쓰인다. */
function unwrap<T>(body: ApiResponse<T>): T {
  if (!body.success || body.data === null) {
    throw new ApiError(
      body.error?.title ?? '오류',
      body.error?.message ?? '알 수 없는 오류가 발생했습니다.',
      body.code,
    )
  }
  return body.data
}

export interface ApiOptions {
  /**
   * 공통 토스트·오류 모달을 띄우지 않는다.
   *
   * 화면이 실패를 직접 표현하는 소수의 예외용이다(채팅 답변 실패 = 오류 말풍선 + 재생성,
   * health 폴링 = 상태 위젯). 기본값 false — 새 API 는 자동으로 공통 처리를 받는다.
   */
  silent?: boolean
}

interface RequestOptions extends ApiOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | FormData
}

/**
 * 인증 헤더를 붙여 호출하고 표준 응답 봉투를 해석하는 **앱의 유일한 HTTP 통로**.
 *
 * 봉투의 세 필드는 서로 다른 UI 로 간다.
 * - `message` → 토스트 (비어 있으면 띄우지 않는다)
 * - `error.title` / `error.message` → 오류 모달
 * - `data` → 호출부 반환값
 *
 * **401 은 "서버가 이 세션을 거부했다"는 뜻이고, 로컬 상태보다 우선한다.** 그래서
 * 갱신을 딱 한 번 시도하고, 그래도 401 이면 로그아웃 처리해 화면이 로그인 상태로
 * 남지 않게 한다. 401 은 백엔드에서 라우트 본문에 들어가기 전(require_user)에
 * 발생하므로, 재시도로 같은 작업이 두 번 실행될 일은 없다.
 *
 * 503(인증 서버 장애)은 건드리지 않는다. 사용자 세션은 멀쩡한데 우리 쪽 사정으로
 * 로그아웃시키면 안 된다.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { silent = false, headers = {}, ...rest } = options

  try {
    const send = (token: string | null) =>
      fetch(`${BASE_URL}${path}`, { ...rest, headers: { ...headers, ...authHeader(token) } })

    let res = await send(await currentToken())

    if (res.status === 401) {
      const renewed = await renewToken()
      if (renewed === null) {
        expireSession()
      } else {
        res = await send(renewed)
        if (res.status === 401) expireSession()
      }
    }

    // 응답이 JSON 이 아니면(프록시가 HTML 502 를 주는 등) 여기서 throw 되고,
    // 아래 catch 가 네트워크 실패로 처리한다.
    const body = (await res.json()) as ApiResponse<T>

    if (!silent && body.message) showToast(body.message, body.success ? 'success' : 'error')

    return unwrap<T>(body) // 실패면 ApiError
  } catch (error) {
    if (!silent) reportApiFailure(error)
    // 화면이 로딩을 끄고 Empty State 대신 오류 영역을 그리려면 실패 사실은 알아야 한다.
    throw error
  }
}

/** 표준 응답 봉투를 벗겨 data 를 반환. 실패면 공통 처리 후 ApiError 로 throw. */
export async function apiGet<T>(path: string, options?: ApiOptions): Promise<T> {
  return request<T>(path, { ...options })
}

/** POST + JSON 바디. 표준 응답 봉투를 벗겨 data 반환, 실패면 ApiError. */
export async function apiPost<T>(path: string, body: unknown, options?: ApiOptions): Promise<T> {
  return request<T>(path, {
    ...options,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * POST + multipart/form-data (파일 업로드). Content-Type 은 브라우저가 boundary 와 함께 자동
 * 설정하므로 직접 넣지 않는다. 나머지(인증·응답 봉투 해석)는 JSON 호출과 동일하다.
 */
export async function apiPostForm<T>(
  path: string,
  form: FormData,
  options?: ApiOptions,
): Promise<T> {
  return request<T>(path, { ...options, method: 'POST', body: form })
}

/** PUT + JSON 바디. 표준 응답 봉투를 벗겨 data 반환, 실패면 ApiError. */
export async function apiPut<T>(path: string, body: unknown, options?: ApiOptions): Promise<T> {
  return request<T>(path, {
    ...options,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** DELETE 요청. 표준 응답 봉투를 벗겨 data 반환, 실패면 ApiError. */
export async function apiDelete<T>(path: string, options?: ApiOptions): Promise<T> {
  return request<T>(path, { ...options, method: 'DELETE' })
}
