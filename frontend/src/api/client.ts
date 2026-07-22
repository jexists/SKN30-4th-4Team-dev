import { ENV } from '../config/env'
import type { ApiResponse } from '../types/api'

const BASE_URL = ENV.apiBaseUrl

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

/** 표준 응답 봉투를 벗겨 data 를 반환. 실패면 ApiError 로 throw. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  return unwrap<T>((await res.json()) as ApiResponse<T>)
}

/** POST + JSON 바디. 표준 응답 봉투를 벗겨 data 반환, 실패면 ApiError. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap<T>((await res.json()) as ApiResponse<T>)
}
