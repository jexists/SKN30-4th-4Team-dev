import { beforeEach, describe, expect, it, vi } from 'vitest'

const signInWithOAuth = vi.hoisted(() => vi.fn())

vi.mock('../config/supabase', () => ({
  supabase: { auth: { signInWithOAuth } },
  isAuthConfigured: true,
}))

import { consumeKakaoReturnTo, startKakaoOAuth } from './kakaoOAuth'

describe('kakaoOAuth', () => {
  beforeEach(() => {
    signInWithOAuth.mockReset()
    signInWithOAuth.mockResolvedValue({ data: {}, error: null })
    sessionStorage.clear()
  })

  it('PKCE callback 주소와 안전한 복귀 경로로 카카오 OAuth를 시작한다', async () => {
    await startKakaoOAuth('/chat/room-1')

    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'kakao',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    expect(consumeKakaoReturnTo()).toBe('/chat/room-1')
  })

  it('외부 URL은 복귀 경로로 저장하지 않는다', async () => {
    await startKakaoOAuth('https://evil.example/phishing')

    expect(consumeKakaoReturnTo()).toBe('/mypage')
  })

  it('Supabase OAuth 오류를 호출자에게 전달한다', async () => {
    signInWithOAuth.mockResolvedValue({
      data: {},
      error: new Error('provider disabled'),
    })

    await expect(startKakaoOAuth('/mypage')).rejects.toThrow('provider disabled')
  })
})
