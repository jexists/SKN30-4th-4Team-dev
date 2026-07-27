import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const completeKakaoSignup = vi.hoisted(() => vi.fn())
const abandonKakaoSignup = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
const blocker = vi.hoisted(() => ({
  state: 'unblocked' as 'unblocked' | 'blocked',
  proceed: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('../../api/kakaoAuth', () => ({ abandonKakaoSignup, completeKakaoSignup }))
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useBlocker: () => blocker,
}))
vi.mock('../../components/Toast/toastStore', () => ({ showToast }))
vi.mock('../../config/supabase', () => ({
  supabase: { auth: {} },
  isAuthConfigured: true,
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: true, signIn: vi.fn(), signOut }),
}))

import { SignUp } from './SignUp'

function renderKakaoSignup() {
  return render(
    <MemoryRouter initialEntries={['/signup?mode=kakao']}>
      <Routes>
        <Route path="/signup" element={<SignUp />} />
        <Route path="/mypage" element={<h1>마이페이지</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SignUp kakao mode', () => {
  beforeEach(() => {
    completeKakaoSignup.mockReset()
    abandonKakaoSignup.mockReset()
    showToast.mockReset()
    signOut.mockReset()
    blocker.state = 'unblocked'
    blocker.proceed.mockReset()
    blocker.reset.mockReset()
    abandonKakaoSignup.mockResolvedValue({ deleted: true })
    completeKakaoSignup.mockResolvedValue({
      status: 'authenticated',
      user: { id: 'u1', email: null, nickname: '새회원', profile_image: null },
    })
  })

  it('이메일·비밀번호 대신 닉네임과 약관만 표시한다', () => {
    renderKakaoSignup()

    expect(screen.queryByLabelText('이메일 주소')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('비밀번호')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/닉네임/)).toBeInTheDocument()
  })

  it('필수약관에 동의하지 않으면 가입 API를 호출하지 않는다', async () => {
    const user = userEvent.setup()
    renderKakaoSignup()

    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(completeKakaoSignup).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith('필수 약관에 동의해주세요.', 'error')
  })

  it('가입을 완료하지 않고 다른 화면으로 이동하면 임시 계정을 삭제하고 로그아웃한다', async () => {
    blocker.state = 'blocked'
    renderKakaoSignup()

    await waitFor(() => expect(abandonKakaoSignup).toHaveBeenCalledTimes(1))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(blocker.proceed).toHaveBeenCalledTimes(1)
  })

  it('임시 계정 삭제에 실패하면 로그아웃하거나 화면을 이탈하지 않는다', async () => {
    blocker.state = 'blocked'
    abandonKakaoSignup.mockRejectedValue(new Error('delete failed'))
    renderKakaoSignup()

    await waitFor(() => expect(blocker.reset).toHaveBeenCalledTimes(1))
    expect(signOut).not.toHaveBeenCalled()
    expect(blocker.proceed).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '회원가입' })).toBeEnabled()
  })

  it('동의한 신규 회원 정보를 백엔드에 저장하고 마이페이지로 이동한다', async () => {
    const user = userEvent.setup()
    renderKakaoSignup()
    await user.type(screen.getByLabelText(/닉네임/), '새회원')
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])
    await user.click(checkboxes[1])

    await user.click(screen.getByRole('button', { name: '회원가입' }))

    await waitFor(() =>
      expect(completeKakaoSignup).toHaveBeenCalledWith({
        nickname: '새회원',
        agree_terms: true,
        agree_privacy: true,
        agree_marketing: true,
      }),
    )
    expect(await screen.findByText('마이페이지')).toBeInTheDocument()
    expect(abandonKakaoSignup).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
  })
})
