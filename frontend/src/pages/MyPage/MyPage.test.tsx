import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MyPage } from './MyPage'

const useAuth = vi.fn()
const useCurrentUser = vi.fn()

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuth() }))
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: (token: string | null) => useCurrentUser(token),
}))

describe('MyPage 프로필', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ token: 'access-token' })
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
        nickname: '홈실드',
      },
      error: null,
    })
  })

  it('로그인 토큰으로 조회한 회원가입 닉네임을 상단에 표시한다', () => {
    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(useCurrentUser).toHaveBeenCalledWith('access-token')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('홈실드 님')
    expect(screen.queryByText('김철수')).not.toBeInTheDocument()
  })

  it('조회 중에는 기존 화면 위치에 로딩 상태를 표시한다', () => {
    useCurrentUser.mockReturnValue({ status: 'loading', data: null, error: null })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('프로필을 불러오는 중입니다.')
  })
})
