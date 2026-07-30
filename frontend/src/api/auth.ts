import { apiDelete, apiGet, apiPatch, apiPostForm } from './client'

/** 백엔드 MeResponse와 1:1인 현재 사용자 정보. */
export interface CurrentUser {
  id: string
  email: string | null
  role: string | null
  nickname: string | null
  login_provider: string | null
  profile_image: string | null
  notify_report_complete: boolean
}

/** 백엔드 WithdrawalResponse와 1:1인 회원 탈퇴 결과. */
export interface Withdrawal {
  id: string
  deleted_at: string
}

export function getCurrentUser(): Promise<CurrentUser> {
  return apiGet<CurrentUser>('/api/v1/me')
}

/** 닉네임 변경. profile 테이블에 저장되어 새로고침해도 유지된다. */
export function updateNickname(nickname: string): Promise<CurrentUser> {
  return apiPatch<CurrentUser>('/api/v1/me', { nickname })
}

/** 위험 보고서 생성 완료 알림 수신 여부. profile 테이블에 저장되어 새로고침해도 유지된다. */
export function updateNotificationPref(enabled: boolean): Promise<CurrentUser> {
  return apiPatch<CurrentUser>('/api/v1/me/notification-prefs', {
    notify_report_complete: enabled,
  })
}

/** 프로필 사진 업로드. Supabase Storage 에 저장되고 URL 이 profile 테이블에 남는다. */
export function uploadAvatar(file: File): Promise<CurrentUser> {
  const form = new FormData()
  form.append('file', file)
  return apiPostForm<CurrentUser>('/api/v1/me/avatar', form)
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
