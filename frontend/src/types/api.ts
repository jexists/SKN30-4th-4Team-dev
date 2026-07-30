export interface ErrorDetail {
  title: string
  message: string
}

/** 백엔드 표준 응답 봉투 (backend/app/schemas/common.py 와 1:1) */
export interface ApiResponse<T> {
  success: boolean
  code: number
  message: string
  data: T | null
  error: ErrorDetail | null
}

/**
 * 커서 페이지네이션 응답 봉투 (백엔드 Page[T] 와 1:1).
 *
 * 커서는 **불투명 문자열**이다 — 저장했다가 다음 요청에 그대로 넘기고 해석하지 않는다.
 * next_cursor 가 null 이면 더 없다.
 */
export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

export interface HealthData {
  status: string
  db: string
  embedder: string
}
