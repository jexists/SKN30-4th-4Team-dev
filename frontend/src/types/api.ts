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

export interface HealthData {
  status: string
  db: string
}
