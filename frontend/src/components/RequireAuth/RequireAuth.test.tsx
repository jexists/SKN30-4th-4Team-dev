import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { expireSession, signIn, signOut, useAuth } from '../../hooks/useAuth'
import { RequireAuth } from './RequireAuth'

// 테스트에선 Supabase 를 끈다 → 인증 상태를 signIn/signOut 으로만 결정론적으로 제어.
// (실제 .env 의 VITE_SUPABASE_* 가 있으면 비동기 getSession 이 상태를 덮어써 불안정해진다.)
vi.mock('../../config/supabase', () => ({ supabase: null, isAuthConfigured: false }))

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

/** 로그인 화면 대역 — RequireAuth 가 실어 보낸 state 를 그대로 드러낸다. */
function LoginStub() {
  const { state } = useLocation() as { state: { from?: string; expired?: boolean } | null }
  return (
    <>
      <h1>로그인 화면</h1>
      {state?.expired && <p>세션이 만료되었습니다.</p>}
      <span data-testid="from">{state?.from ?? ''}</span>
    </>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<LoginStub />} />
        <Route element={<RequireAuth />}>
          <Route path="/mypage" element={<MyPageStub />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

// 컴포넌트가 마운트되지 않은 시점에 초기화한다(afterEach 로 하면 언마운트 전에
// 상태가 바뀌어 act() 경고가 난다).
beforeEach(() => {
  signOut() // 모듈 세션 스토어 초기화
})

describe('RequireAuth', () => {
  it('비로그인 상태로 보호된 화면에 들어가면 로그인 화면으로 보낸다', () => {
    renderAt('/mypage')

    expect(screen.getByText('로그인 화면')).toBeInTheDocument()
    expect(screen.queryByText('마이페이지 화면')).not.toBeInTheDocument()
  })

  it('로그인 상태면 보호된 화면을 그대로 보여준다', () => {
    signIn('test-token')

    renderAt('/mypage')

    expect(screen.getByText('마이페이지 화면')).toBeInTheDocument()
  })

  it('마이페이지에 머문 채 로그아웃하면 곧바로 로그인 화면으로 되돌린다', async () => {
    signIn('test-token')
    const user = userEvent.setup()

    renderAt('/mypage')
    await user.click(screen.getByRole('button', { name: '로그아웃' }))

    expect(screen.getByText('로그인 화면')).toBeInTheDocument()
    expect(screen.queryByText('마이페이지 화면')).not.toBeInTheDocument()
  })

  it('세션이 끊겨서 튕긴 경우엔 그 사실을 로그인 화면에 알린다', () => {
    signIn('test-token')
    renderAt('/mypage')

    act(() => expireSession()) // 서버가 401 로 세션을 거부한 상황

    expect(screen.getByText('로그인 화면')).toBeInTheDocument()
    expect(screen.getByText('세션이 만료되었습니다.')).toBeInTheDocument()
    expect(screen.getByTestId('from')).toHaveTextContent('/mypage')
  })

  it('사용자가 직접 로그아웃한 경우엔 만료 안내를 띄우지 않는다', async () => {
    signIn('test-token')
    const user = userEvent.setup()

    renderAt('/mypage')
    await user.click(screen.getByRole('button', { name: '로그아웃' }))

    expect(screen.queryByText('세션이 만료되었습니다.')).not.toBeInTheDocument()
  })
})
