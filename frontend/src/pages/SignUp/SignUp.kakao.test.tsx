import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const completeKakaoSignup = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../../api/kakaoAuth', () => ({ completeKakaoSignup }))
vi.mock('../../components/Toast/toastStore', () => ({ showToast }))
vi.mock('../../config/supabase', () => ({
  supabase: { auth: {} },
  isAuthConfigured: true,
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: true, signIn: vi.fn() }),
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
    showToast.mockReset()
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
  })
})
