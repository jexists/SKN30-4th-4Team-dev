import { apiGet } from './client'

/** 백엔드 MeResponse와 1:1인 현재 사용자 정보. */
export interface CurrentUser {
  id: string
  email: string | null
  role: string | null
  nickname: string | null
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiGet<CurrentUser>('/api/v1/me')
}
