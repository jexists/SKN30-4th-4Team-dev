import { ENV } from '../config/env'
import { supabase } from '../config/supabase'
import { expireSession } from '../hooks/useAuth'
import type { ApiResponse } from '../types/api'

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

export class ApiError extends Error {
  title: string
  code: number

  constructor(title: string, message: string, code: number) {
    super(message)
    this.title = title
    this.code = code
  }
}

function unwrap<T>(body: ApiResponse<T>): T {
  if (!body.success || body.data === null) {
    throw new ApiError(
      body.error?.title ?? 'ERROR',
      body.error?.message ?? '알 수 없는 오류가 발생했습니다.',
      body.code,
    )
  }
  return body.data
}

interface RequestOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
}

/**
 * 인증 헤더를 붙여 호출하고 표준 응답 봉투를 벗긴다.
 *
 * **401 은 "서버가 이 세션을 거부했다"는 뜻이고, 로컬 상태보다 우선한다.** 그래서
 * 갱신을 딱 한 번 시도하고, 그래도 401 이면 로그아웃 처리해 화면이 로그인 상태로
 * 남지 않게 한다. 401 은 백엔드에서 라우트 본문에 들어가기 전(require_user)에
 * 발생하므로, 재시도로 같은 작업이 두 번 실행될 일은 없다.
 *
 * 503(AUTH_UNAVAILABLE — 인증 서버 장애)은 건드리지 않는다. 사용자 세션은 멀쩡한데
 * 우리 쪽 사정으로 로그아웃시키면 안 된다.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { headers = {}, ...rest } = options
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

  return unwrap<T>((await res.json()) as ApiResponse<T>)
}

/** 표준 응답 봉투를 벗겨 data 를 반환. 실패면 ApiError 로 throw. */
export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path)
}

/** POST + JSON 바디. 표준 응답 봉투를 벗겨 data 반환, 실패면 ApiError. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
