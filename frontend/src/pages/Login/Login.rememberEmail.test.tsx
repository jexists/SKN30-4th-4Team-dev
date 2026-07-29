import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 인증을 끄면 폼은 그대로 그려지고 실제 로그인 호출만 막힌다.
vi.mock('../../config/supabase', () => ({ supabase: null, isAuthConfigured: false }))

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

const HELP_TITLE = '비밀번호 찾기'
const HELP_TEXT_1 = '현재 비밀번호 찾기 기능은 준비 중입니다.'
const HELP_TEXT_2 = '비밀번호 재설정이 필요하신 경우 고객센터로 문의해 주세요.'

describe('Login 아이디 저장', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('저장된 이메일이 있으면 입력창에 자동으로 채우고 체크박스도 체크한다', () => {
    savedEmail.set('saved@homeshield.co.kr')

    renderLogin()

    expect(screen.getByLabelText('이메일 주소')).toHaveValue('saved@homeshield.co.kr')
    expect(screen.getByRole('checkbox', { name: '아이디 저장' })).toBeChecked()
  })

  it('저장된 이메일이 없으면 입력창은 비어 있고 체크박스도 해제돼 있다', () => {
    renderLogin()

    expect(screen.getByLabelText('이메일 주소')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: '아이디 저장' })).not.toBeChecked()
  })
})

describe('Login 비밀번호 찾기 모달', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.sessionStorage.clear()
  })

  it('비밀번호 찾기를 누르면 안내 문구가 담긴 모달이 뜬다', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: '비밀번호 찾기' }))

    const dialog = screen.getByRole('dialog', { name: HELP_TITLE })
    expect(dialog).toHaveTextContent(HELP_TEXT_1)
    expect(dialog).toHaveTextContent(HELP_TEXT_2)
  })

  it('확인을 누르면 모달이 닫힌다', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: '비밀번호 찾기' }))
    await user.click(screen.getByRole('button', { name: '확인' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: HELP_TITLE })).not.toBeInTheDocument()
    })
  })

  it('ESC 를 누르면 모달이 닫힌다', async () => {
    const user = userEvent.setup()
    renderLogin()

    await user.click(screen.getByRole('button', { name: '비밀번호 찾기' }))
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: HELP_TITLE })).not.toBeInTheDocument()
    })
  })
})
