import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { Login } from './Login'

// 인증을 끄면 폼은 그대로 그려지고 실제 로그인 호출만 막힌다.
vi.mock('../../config/supabase', () => ({ supabase: null, isAuthConfigured: false }))

function renderLogin(state?: { from?: string; expired?: boolean }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  )
}

const EXPIRED_NOTICE = '세션이 만료되었습니다. 다시 로그인해 주세요.'

describe('Login', () => {
  it('세션 만료로 튕겨왔으면 왜 튕겼는지 알려준다', () => {
    renderLogin({ from: '/chat', expired: true })

    expect(screen.getByRole('status')).toHaveTextContent(EXPIRED_NOTICE)
  })

  it('그냥 로그인하러 들어온 경우엔 만료 안내를 띄우지 않는다', () => {
    renderLogin()

    expect(screen.queryByText(EXPIRED_NOTICE)).not.toBeInTheDocument()
  })

  it('보호된 화면에서 튕겼어도 세션 만료가 아니면 안내하지 않는다', () => {
    renderLogin({ from: '/mypage', expired: false })

    expect(screen.queryByText(EXPIRED_NOTICE)).not.toBeInTheDocument()
  })
})
