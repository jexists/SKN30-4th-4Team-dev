import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const exchangeCodeForSession = vi.hoisted(() => vi.fn())
const signIn = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const kakaoLogin = vi.hoisted(() => vi.fn())
const abandonKakaoSignup = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../../config/supabase', () => ({
  supabase: { auth: { exchangeCodeForSession } },
  isAuthConfigured: true,
}))
vi.mock('../../hooks/useAuth', () => ({ signIn, signOut }))
vi.mock('../../api/kakaoAuth', () => ({ abandonKakaoSignup, kakaoLogin }))
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
    abandonKakaoSignup.mockReset()
    signIn.mockReset()
    signOut.mockReset()
    showToast.mockReset()
    sessionStorage.clear()
    exchangeCodeForSession.mockResolvedValue({
      data: { session: { access_token: 'supabase-access-token' } },
      error: null,
    })
    abandonKakaoSignup.mockResolvedValue({ deleted: true })
  })

  it('카드 없이 간단한 로그인 확인 상태만 표시한다', () => {
    exchangeCodeForSession.mockReturnValue(new Promise(() => {}))

    renderCallback('/auth/callback?code=loading-code')

    expect(screen.getByRole('status')).toHaveTextContent('로그인 정보를 확인하고 있어요.')
    expect(screen.queryByText('홈쉴드 로그인 처리 중')).not.toBeInTheDocument()
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

  it('신규 회원은 가입 화면으로 이동하기 전에 회원가입 확인 모달을 보여준다', async () => {
    const user = userEvent.setup()
    kakaoLogin.mockResolvedValue({
      status: 'signup_required',
      user: { id: 'u1', email: null, nickname: '카카오닉', profile_image: null },
    })

    renderCallback()

    expect(await screen.findByRole('dialog', { name: '회원가입 안내' })).toBeInTheDocument()
    expect(
      screen.getByText('회원가입이 되어 있지 않습니다. 회원가입하시겠습니까?'),
    ).toBeInTheDocument()
    expect(screen.queryByText('카카오 회원가입')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(await screen.findByText('카카오 회원가입')).toBeInTheDocument()
    expect(abandonKakaoSignup).not.toHaveBeenCalled()
  })

  it('회원가입 화면에서 시작했으면 되묻지 않고 바로 가입 폼으로 보낸다', async () => {
    kakaoLogin.mockResolvedValue({
      status: 'signup_required',
      user: { id: 'u1', email: null, nickname: '카카오닉', profile_image: null },
    })
    // SignUp 이 startKakaoOAuth(..., 'signup') 으로 심어 두는 값.
    sessionStorage.setItem('homeshield.kakao.intent', 'signup')

    renderCallback()

    expect(await screen.findByText('카카오 회원가입')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '회원가입 안내' })).not.toBeInTheDocument()
    expect(abandonKakaoSignup).not.toHaveBeenCalled()
  })

  it('가입 의도는 한 번만 쓰여 다음 로그인 시도에 새어 나가지 않는다', async () => {
    kakaoLogin.mockResolvedValue({
      status: 'signup_required',
      user: { id: 'u1', email: null, nickname: '카카오닉', profile_image: null },
    })
    sessionStorage.setItem('homeshield.kakao.intent', 'signup')

    renderCallback()
    await screen.findByText('카카오 회원가입')

    expect(sessionStorage.getItem('homeshield.kakao.intent')).toBeNull()
  })

  it('회원가입 확인을 취소하면 임시 계정을 삭제하고 비회원으로 돌아간다', async () => {
    const user = userEvent.setup()
    kakaoLogin.mockResolvedValue({
      status: 'signup_required',
      user: { id: 'u1', email: null, nickname: '카카오닉', profile_image: null },
    })

    renderCallback('/auth/callback?code=cancel-signup-code')
    await user.click(await screen.findByRole('button', { name: '취소' }))

    await waitFor(() => expect(abandonKakaoSignup).toHaveBeenCalledTimes(1))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('로그인')).toBeInTheDocument()
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
