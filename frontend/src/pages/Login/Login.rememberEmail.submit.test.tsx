import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 로그인 성공 분기(아이디 저장 적용)를 실제로 태우려면 supabase 를 null 이 아닌
// signInWithPassword 목으로 채워야 한다. 다른 Login 테스트들은 supabase: null 로
// "폼은 그려지되 제출은 막힌" 상태만 다루므로, 목이 충돌하지 않도록 파일을 분리한다.
const signInWithPassword = vi.hoisted(() => vi.fn())
const signIn = vi.hoisted(() => vi.fn())

vi.mock('../../config/supabase', () => ({
  supabase: { auth: { signInWithPassword } },
  isAuthConfigured: true,
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: false, signIn }),
}))

import { savedEmail } from '../../config/authStorage'
import { Login } from './Login'

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login' }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 이메일 입력을 새로 채우고(기존 자동완성 값 제거) 비밀번호까지 입력한 뒤 제출한다. */
async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, email: string) {
  const emailInput = screen.getByLabelText('이메일 주소')
  await user.clear(emailInput)
  await user.type(emailInput, email)
  await user.type(screen.getByLabelText('비밀번호'), 'password123!')
  await user.click(screen.getByRole('button', { name: '로그인' }))
}

describe('Login 아이디 저장 — 로그인 성공 경로', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
    signInWithPassword.mockReset()
    signIn.mockReset()
    signInWithPassword.mockResolvedValue({
      data: { session: { access_token: 'tok' } },
      error: null,
    })
  })

  it('체크된 상태로 로그인에 성공하면 입력한 이메일을 저장한다', async () => {
    const user = userEvent.setup()
    renderLogin()

    // 저장된 이메일이 없어 체크박스는 기본 해제 상태다 — 직접 체크한다.
    await user.click(screen.getByRole('checkbox', { name: '아이디 저장' }))
    await fillAndSubmit(user, 'new@homeshield.co.kr')

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'new@homeshield.co.kr',
      password: 'password123!',
    })
    expect(savedEmail.get()).toBe('new@homeshield.co.kr')
  })

  it('체크 해제 상태로 로그인에 성공하면 기존 저장값을 지운다', async () => {
    savedEmail.set('old@homeshield.co.kr')
    const user = userEvent.setup()
    renderLogin()

    // 저장된 이메일이 있어 체크박스는 기본 체크 상태다 — 해제한다.
    await user.click(screen.getByRole('checkbox', { name: '아이디 저장' }))
    await fillAndSubmit(user, 'old@homeshield.co.kr')

    expect(savedEmail.get()).toBeNull()
  })

  it('저장된 이메일이 있는 상태에서 다른 이메일로 바꿔 로그인하면 저장값이 갱신된다', async () => {
    savedEmail.set('old@homeshield.co.kr')
    const user = userEvent.setup()
    renderLogin()

    // 체크박스는 이미 체크돼 있다 — 그대로 둔 채 이메일만 바꾼다.
    await fillAndSubmit(user, 'new@homeshield.co.kr')

    expect(savedEmail.get()).toBe('new@homeshield.co.kr')
  })
})
