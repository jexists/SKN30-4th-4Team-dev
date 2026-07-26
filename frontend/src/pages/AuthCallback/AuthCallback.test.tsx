import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeCodeForSession = vi.hoisted(() => vi.fn())
const signIn = vi.hoisted(() => vi.fn())
const kakaoLogin = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../../config/supabase', () => ({
  supabase: { auth: { exchangeCodeForSession } },
  isAuthConfigured: true,
}))
vi.mock('../../hooks/useAuth', () => ({ signIn }))
vi.mock('../../api/kakaoAuth', () => ({ kakaoLogin }))
vi.mock('../../components/Toast/toastStore', () => ({ showToast }))

import { setKakaoReturnTo } from '../../auth/kakaoOAuth'
import { AuthCallback } from './AuthCallback'

function renderCallback(url = '/auth/callback?code=oauth-code', strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/mypage" element={<h1>마이페이지</h1>} />
        <Route path="/chat" element={<h1>채팅</h1>} />
        <Route path="/signup" element={<h1>카카오 회원가입</h1>} />
        <Route path="/login" element={<h1>로그인</h1>} />
      </Routes>
    </MemoryRouter>
  )
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

describe('AuthCallback', () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset()
    kakaoLogin.mockReset()
    signIn.mockReset()
    showToast.mockReset()
    sessionStorage.clear()
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-access-token' } },
      error: null,
    })
  })

  it('기존 회원은 원래 가려던 내부 경로로 복귀한다', async () => {
    setKakaoReturnTo('/chat')
    kakaoLogin.mockResolvedValue({
      status: 'authenticated',
      user: { id: 'u1', email: null, nickname: '회원', profile_image: null },
    })

    renderCallback()

    expect(await screen.findByText('채팅')).toBeInTheDocument()
    expect(exchangeCodeForSession).toHaveBeenCalledWith('oauth-code')
    expect(signIn).toHaveBeenCalledWith('supabase-access-token')
  })

  it('신규 회원은 기존 가입 화면의 카카오 모드로 보낸다', async () => {
    kakaoLogin.mockResolvedValue({
      status: 'signup_required',
      user: { id: 'u1', email: null, nickname: '카카오닉', profile_image: null },
    })

    renderCallback()

    expect(await screen.findByText('카카오 회원가입')).toBeInTheDocument()
  })

  it('StrictMode에서도 authorization code와 로그인 API를 한 번만 처리한다', async () => {
    kakaoLogin.mockResolvedValue({
      status: 'authenticated',
      user: { id: 'u1', email: null, nickname: '회원', profile_image: null },
    })

    renderCallback('/auth/callback?code=strict-oauth-code', true)

    expect(await screen.findByText('마이페이지')).toBeInTheDocument()
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1)
    expect(kakaoLogin).toHaveBeenCalledTimes(1)
  })
  it('잘못된 callback은 로그인 화면으로 보내고 오류를 알린다', async () => {
    renderCallback('/auth/callback?error=access_denied&error_description=cancelled')

    expect(await screen.findByText('로그인')).toBeInTheDocument()
    await waitFor(() => expect(showToast).toHaveBeenCalled())
    expect(kakaoLogin).not.toHaveBeenCalled()
  })
})
