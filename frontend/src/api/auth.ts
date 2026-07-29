import { apiDelete, apiGet } from './client'

/** 백엔드 MeResponse와 1:1인 현재 사용자 정보. */
export interface CurrentUser {
  id: string
  email: string | null
  role: string | null
  nickname: string | null
}

/** 백엔드 WithdrawalResponse와 1:1인 회원 탈퇴 결과. */
export interface Withdrawal {
  id: string
  deleted_at: string
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiGet<CurrentUser>('/api/v1/me')
}

/**
 * 회원 탈퇴. 서버는 Soft Delete(is_deleted/deleted_at) 로 계정을 잠그고 Refresh Token 을
 * 폐기한다 — 대화·계약서 데이터는 지금은 그대로 남는다.
 *
 * 성공하면 현재 세션은 더 이상 쓸 수 없으므로, 호출부는 반드시 로그아웃까지 처리한다.
 */
export function withdrawMember(): Promise<Withdrawal> {
  return apiDelete<Withdrawal>('/api/v1/me')
}
