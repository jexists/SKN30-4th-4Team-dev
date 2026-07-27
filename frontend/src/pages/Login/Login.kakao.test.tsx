import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const startKakaoOAuth = vi.hoisted(() => vi.fn())

vi.mock('../../auth/kakaoOAuth', () => ({ startKakaoOAuth }))
vi.mock('../../config/supabase', () => ({ supabase: null, isAuthConfigured: false }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: false, signIn: vi.fn() }),
}))

import { Login } from './Login'

describe('Login kakao button', () => {
  beforeEach(() => {
    startKakaoOAuth.mockReset()
    startKakaoOAuth.mockResolvedValue(undefined)
  })

  it('보호 화면의 복귀 경로를 유지해 카카오 OAuth를 시작한다', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={[{ pathname: '/login', state: { from: '/chat/room-1' } }]}>
        <Routes>
          <Route path="/login" element={<Login />} />
        </Routes>
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: '카카오로 로그인' }))

    expect(startKakaoOAuth).toHaveBeenCalledWith('/chat/room-1')
  })
})
