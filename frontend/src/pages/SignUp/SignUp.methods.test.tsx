import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const startKakaoOAuth = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock('../../auth/kakaoOAuth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth/kakaoOAuth')>()),
  startKakaoOAuth,
}))
// useBlocker 는 data router 에서만 동작한다 — 이 화면은 카카오 모드가 아니라 막을 것도 없다.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useBlocker: () => ({ state: 'unblocked', proceed: vi.fn(), reset: vi.fn() }),
}))
vi.mock('../../components/Toast/toastStore', () => ({ showToast }))
vi.mock('../../config/supabase', () => ({ supabase: null, isAuthConfigured: false }))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthed: false, signIn: vi.fn(), signOut: vi.fn() }),
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

const EMAIL_LABEL = '이메일 주소'
const START_EMAIL = '이메일로 시작하기'
const START_KAKAO = '카카오로 시작하기'

describe('SignUp 가입 방식 선택', () => {
  beforeEach(() => {
    startKakaoOAuth.mockReset()
    startKakaoOAuth.mockResolvedValue(undefined)
    showToast.mockReset()
    sessionStorage.clear()
  })

  it('처음에는 이메일 입력폼 없이 방식 선택과 약관만 보여준다', () => {
    renderSignUp()

    expect(screen.getByRole('button', { name: START_KAKAO })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: START_EMAIL })).toBeInTheDocument()
    expect(screen.queryByLabelText(EMAIL_LABEL)).not.toBeInTheDocument()
    expect(screen.queryByLabelText('비밀번호')).not.toBeInTheDocument()
    // 약관은 방식과 무관하게 처음부터 보인다.
    expect(screen.getByRole('checkbox', { name: '전체 동의' })).toBeInTheDocument()
    // 방식을 고르기 전에는 제출 버튼도 없다.
    expect(screen.queryByRole('button', { name: '회원가입' })).not.toBeInTheDocument()
  })

  it('네이버 회원가입 버튼과 "또는" 구분선을 더 이상 노출하지 않는다', () => {
    renderSignUp()

    expect(screen.queryByRole('button', { name: /네이버/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/또는/)).not.toBeInTheDocument()
  })

  it('이메일로 시작하기를 누르면 같은 화면에서 입력폼이 펼쳐진다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()

    await user.click(screen.getByRole('button', { name: START_EMAIL }))

    expect(screen.getByLabelText(EMAIL_LABEL)).toBeInTheDocument()
    expect(screen.getByLabelText('닉네임')).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호')).toBeInTheDocument()
    expect(screen.getByLabelText('비밀번호 확인')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '회원가입' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: START_EMAIL })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('다시 누르면 접히고, 입력했던 값은 다시 열었을 때 남아 있다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()

    await user.click(screen.getByRole('button', { name: START_EMAIL }))
    await user.type(screen.getByLabelText(EMAIL_LABEL), 'me@homeshield.co.kr')
    await user.click(screen.getByRole('button', { name: START_EMAIL }))

    expect(screen.queryByLabelText(EMAIL_LABEL)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: START_EMAIL }))
    expect(screen.getByLabelText(EMAIL_LABEL)).toHaveValue('me@homeshield.co.kr')
  })

  it('카카오로 시작하기는 입력값을 남겨 두고 OAuth 를 시작한다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))

    await user.click(screen.getByRole('button', { name: START_KAKAO }))

    // 'signup' 의도를 함께 넘겨야 콜백이 "가입하시겠습니까?" 를 되묻지 않는다.
    expect(startKakaoOAuth).toHaveBeenCalledWith('/mypage', 'signup')
    // 리다이렉트로 화면을 떠나므로, 돌아왔을 때 복원할 값이 담겨 있어야 한다.
    const draft = JSON.parse(sessionStorage.getItem('homeshield.signupDraft') ?? '{}') as {
      agreements?: { terms?: boolean; marketing?: boolean }
    }
    expect(draft.agreements?.terms).toBe(true)
    expect(draft.agreements?.marketing).toBe(true)
  })
})

describe('SignUp 약관 동의', () => {
  beforeEach(() => {
    showToast.mockReset()
    sessionStorage.clear()
  })

  it('전체 동의를 켜면 개별 항목이 모두 켜지고, 끄면 모두 꺼진다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()
    const all = screen.getByRole('checkbox', { name: '전체 동의' })
    const terms = screen.getByRole('checkbox', { name: /이용약관/ })
    const privacy = screen.getByRole('checkbox', { name: /개인정보 처리방침/ })
    const marketing = screen.getByRole('checkbox', { name: /마케팅/ })

    await user.click(all)
    expect(terms).toBeChecked()
    expect(privacy).toBeChecked()
    expect(marketing).toBeChecked()

    await user.click(all)
    expect(terms).not.toBeChecked()
    expect(privacy).not.toBeChecked()
    expect(marketing).not.toBeChecked()
  })

  it('개별 항목을 모두 켜면 전체 동의도 켜지고, 하나라도 끄면 풀린다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()
    const all = screen.getByRole('checkbox', { name: '전체 동의' })

    await user.click(screen.getByRole('checkbox', { name: /이용약관/ }))
    await user.click(screen.getByRole('checkbox', { name: /개인정보 처리방침/ }))
    expect(all).not.toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: /마케팅/ }))
    expect(all).toBeChecked()

    await user.click(screen.getByRole('checkbox', { name: /마케팅/ }))
    expect(all).not.toBeChecked()
  })

  it('일부만 동의한 상태는 전체 동의를 indeterminate 로 표시한다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()
    const all = screen.getByRole('checkbox', { name: '전체 동의' }) as HTMLInputElement

    expect(all.indeterminate).toBe(false)

    await user.click(screen.getByRole('checkbox', { name: /이용약관/ }))
    expect(all.indeterminate).toBe(true)
  })

  it('보기 버튼은 이용약관과 개인정보 처리방침을 각각 다른 모달로 연다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()
    const [termsView, privacyView] = screen.getAllByRole('button', { name: /보기/ })

    await user.click(termsView)
    const termsDialog = screen.getByRole('dialog')
    expect(termsDialog).toHaveAccessibleName(/이용약관/)
    await user.click(screen.getByRole('button', { name: '닫기' }))

    await user.click(privacyView)
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/개인정보/)
  })

  it('필수 약관에 동의하지 않으면 이메일 가입을 진행하지 않는다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()
    await user.click(screen.getByRole('button', { name: START_EMAIL }))
    await user.type(screen.getByLabelText(EMAIL_LABEL), 'me@homeshield.co.kr')
    await user.type(screen.getByLabelText('닉네임'), '새회원')
    await user.type(screen.getByLabelText('비밀번호'), 'password123')
    await user.type(screen.getByLabelText('비밀번호 확인'), 'password123')

    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(showToast).toHaveBeenCalledWith('필수 약관에 동의해주세요.', 'error')
  })

  it('닉네임이 비어 있으면 이메일 가입을 진행하지 않는다', async () => {
    const user = userEvent.setup({ delay: null })
    renderSignUp()
    await user.click(screen.getByRole('button', { name: START_EMAIL }))
    await user.type(screen.getByLabelText(EMAIL_LABEL), 'me@homeshield.co.kr')
    await user.type(screen.getByLabelText('비밀번호'), 'password123')
    await user.type(screen.getByLabelText('비밀번호 확인'), 'password123')
    await user.click(screen.getByRole('checkbox', { name: '전체 동의' }))

    await user.click(screen.getByRole('button', { name: '회원가입' }))

    expect(showToast).toHaveBeenCalledWith('닉네임을 입력해주세요.', 'error')
  })
})
