import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { AUTH_TOKEN_KEY, useAuth } from '../../hooks/useAuth'
import { RequireAuth } from './RequireAuth'

/** 아바타 드롭다운의 로그아웃 항목을 대신하는 테스트용 화면. */
function MyPageStub() {
  const { signOut } = useAuth()

  return (
    <>
      <h1>마이페이지 화면</h1>
      <button onClick={signOut}>로그아웃</button>
    </>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<h1>로그인 화면</h1>} />
        <Route element={<RequireAuth />}>
          <Route path="/mypage" element={<MyPageStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  localStorage.clear()
})

describe('RequireAuth', () => {
  it('비로그인 상태로 보호된 화면에 들어가면 로그인 화면으로 보낸다', () => {
    renderAt('/mypage')

    expect(screen.getByText('로그인 화면')).toBeInTheDocument()
    expect(screen.queryByText('마이페이지 화면')).not.toBeInTheDocument()
  })

  it('로그인 상태면 보호된 화면을 그대로 보여준다', () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'test-token')

    renderAt('/mypage')

    expect(screen.getByText('마이페이지 화면')).toBeInTheDocument()
  })

  it('마이페이지에 머문 채 로그아웃하면 곧바로 로그인 화면으로 되돌린다', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'test-token')
    const user = userEvent.setup()

    renderAt('/mypage')
    await user.click(screen.getByRole('button', { name: '로그아웃' }))

    expect(screen.getByText('로그인 화면')).toBeInTheDocument()
    expect(screen.queryByText('마이페이지 화면')).not.toBeInTheDocument()
  })
})
