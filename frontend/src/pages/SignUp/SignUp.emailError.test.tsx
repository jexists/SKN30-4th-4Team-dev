import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const signUp = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../../config/supabase', () => ({
  supabase: { auth: { signUp } },
  isAuthConfigured: true,
}))
vi.mock('../../components/Toast/toastStore', () => ({ showToast }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: false, signIn: vi.fn(), signOut: vi.fn() }),
}))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useBlocker: () => ({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() }),
}))

import { SignUp } from './SignUp'

function renderSignUp() {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<SignUp />} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 유효한 값을 모두 채우고 제출한다 — 서버 오류 분기만 보기 위한 준비. */
async function submitValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: '이메일로 시작하기' }))
  await user.type(screen.getByLabelText('이메일 주소'), 'taken@homeshield.co.kr')
  await user.type(screen.getByLabelText('닉네임'), '새회원')
  await user.type(screen.getByLabelText('비밀번호'), 'password123')
  await user.type(screen.getByLabelText('비밀번호 확인'), 'password123')
  await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))
  await user.click(screen.getByRole('button', { name: '회원가입' }))
}

describe('SignUp 가입 실패 안내', () => {
  beforeEach(() => {
    signUp.mockReset()
    showToast.mockReset()
    sessionStorage.clear()
  })

  it('이미 가입된 이메일이면 영어 원문 대신 한국어로 알려준다', async () => {
    const user = userEvent.setup({ delay: null })
    signUp.mockResolvedValue({
      data: { session: null },
      error: { code: 'user_already_exists', message: 'User already registered' },
    })
    renderSignUp()

    await submitValidForm(user)

    expect(showToast).toHaveBeenCalledWith('이미 가입된 이메일입니다. 로그인해 주세요.', 'error')
    expect(showToast).not.toHaveBeenCalledWith('User already registered', 'error')
  })

  it('code 가 없는 구버전 응답도 message 로 알아본다', async () => {
    const user = userEvent.setup({ delay: null })
    signUp.mockResolvedValue({
      data: { session: null },
      error: { message: 'User already registered' },
    })
    renderSignUp()

    await submitValidForm(user)

    expect(showToast).toHaveBeenCalledWith('이미 가입된 이메일입니다. 로그인해 주세요.', 'error')
  })

  it('모르는 오류도 영어를 그대로 흘리지 않는다', async () => {
    const user = userEvent.setup({ delay: null })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    signUp.mockResolvedValue({
      data: { session: null },
      error: { code: 'unexpected_failure', message: 'Database error saving new user' },
    })
    renderSignUp()

    await submitValidForm(user)

    expect(showToast).toHaveBeenCalledWith(
      '회원가입에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      'error',
    )
    vi.restoreAllMocks()
  })
})
