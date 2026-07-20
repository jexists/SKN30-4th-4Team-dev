import type { ApiResponse } from '../types/api'

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
  title: string
  code: number

  constructor(title: string, message: string, code: number) {
    super(message)
    this.title = title
    this.code = code
  }
}

/** 표준 응답 봉투를 벗겨 data 를 반환. 실패면 ApiError 로 throw. */
export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`)
  const body = (await res.json()) as ApiResponse<T>

  if (!body.success || body.data === null) {
    throw new ApiError(
      body.error?.title ?? 'ERROR',
      body.error?.message ?? '알 수 없는 오류가 발생했습니다.',
      body.code,
    )
  }
  return body.data
}
