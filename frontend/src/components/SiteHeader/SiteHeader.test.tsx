import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AUTH_TOKEN_KEY } from '../../hooks/useAuth'
import { SiteHeader } from './SiteHeader'

function renderHeader() {
  return render(
    <MemoryRouter>
      <SiteHeader />
    </MemoryRouter>,
  )
}

function signedIn() {
  localStorage.setItem(AUTH_TOKEN_KEY, 'test-token')
}

afterEach(() => {
  localStorage.clear()
})

describe('SiteHeader', () => {
  it('비로그인 상태면 로그인 버튼을 보여준다', () => {
    renderHeader()

    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login')
    expect(screen.queryByLabelText('내 계정')).not.toBeInTheDocument()
  })

  it('비로그인 상태면 최근 기록·알림 버튼을 숨긴다', () => {
    renderHeader()

    expect(screen.queryByLabelText('최근 기록')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('알림')).not.toBeInTheDocument()
  })

  it('로그인 상태면 로그인 버튼 대신 아바타를 보여준다', () => {
    signedIn()

    renderHeader()

    expect(screen.getByLabelText('내 계정')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '로그인' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('최근 기록')).toBeInTheDocument()
    expect(screen.getByLabelText('알림')).toBeInTheDocument()
  })

  it('아바타를 누르면 마이페이지·로그아웃 메뉴가 열린다', async () => {
    signedIn()
    const user = userEvent.setup()

    renderHeader()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('내 계정'))

    expect(screen.getByRole('menuitem', { name: '마이페이지' })).toHaveAttribute('href', '/mypage')
    expect(screen.getByRole('menuitem', { name: '로그아웃' })).toBeInTheDocument()
  })

  it('메뉴 바깥을 누르면 닫힌다', async () => {
    signedIn()
    const user = userEvent.setup()

    renderHeader()
    await user.click(screen.getByLabelText('내 계정'))
    await user.click(document.body)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('로그아웃을 누르면 메뉴가 닫히고 로그인 버튼으로 바뀐다', async () => {
    signedIn()
    const user = userEvent.setup()

    renderHeader()
    await user.click(screen.getByLabelText('내 계정'))
    await user.click(screen.getByRole('menuitem', { name: '로그아웃' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인' })).toBeInTheDocument()
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
  })
})
