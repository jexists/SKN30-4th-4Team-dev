import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRegistration = vi.hoisted(() => vi.fn())
const setKakaoReturnTo = vi.hoisted(() => vi.fn())

vi.mock('../../api/kakaoAuth', () => ({ getRegistration }))
vi.mock('../../auth/kakaoOAuth', () => ({ setKakaoReturnTo }))
vi.mock('../../config/supabase', () => ({ supabase: {}, isAuthConfigured: true }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthed: true,
    isLoading: false,
    sessionExpired: false,
  }),
}))

import { RequireAuth } from './RequireAuth'

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/mypage?tab=profile']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/mypage" element={<h1>마이페이지</h1>} />
        </Route>
        <Route path="/signup" element={<h1>카카오 회원가입</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth registration guard', () => {
  beforeEach(() => {
    getRegistration.mockReset()
    setKakaoReturnTo.mockReset()
  })

  it('가입이 완료된 사용자는 보호 화면을 보여준다', async () => {
    getRegistration.mockResolvedValue({ status: 'authenticated' })

    renderGuard()

    expect(await screen.findByText('마이페이지')).toBeInTheDocument()
  })

  it('JWT만 있고 앱 회원이 아니면 카카오 가입 화면으로 보낸다', async () => {
    getRegistration.mockResolvedValue({ status: 'signup_required' })

    renderGuard()

    expect(await screen.findByText('카카오 회원가입')).toBeInTheDocument()
    expect(setKakaoReturnTo).toHaveBeenCalledWith('/mypage?tab=profile')
  })
})
