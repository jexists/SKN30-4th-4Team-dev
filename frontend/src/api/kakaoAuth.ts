import { apiDelete, apiGet, apiPost } from './client'

export type RegistrationStatus = 'authenticated' | 'signup_required'

export interface KakaoUser {
  id: string
  email: string | null
  nickname: string | null
  profile_image: string | null
}

export interface KakaoAuthResult {
  status: RegistrationStatus
  user: KakaoUser
}

export interface KakaoSignUpRequest {
  nickname: string | null
  agree_terms: true
  agree_privacy: true
  agree_marketing: boolean
}

export function kakaoLogin(): Promise<KakaoAuthResult> {
  return apiPost<KakaoAuthResult>('/api/v1/auth/kakao/login', {})
}

export function getRegistration(): Promise<{ status: RegistrationStatus }> {
  return apiGet<{ status: RegistrationStatus }>('/api/v1/auth/registration')
}

export function abandonKakaoSignup(): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>('/api/v1/auth/kakao/pending')
}

export function completeKakaoSignup(body: KakaoSignUpRequest): Promise<KakaoAuthResult> {
  return apiPost<KakaoAuthResult>('/api/v1/auth/signup', body)
}
