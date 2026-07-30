import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { signIn, signOut } from '../../hooks/useAuth'
import { RequireAuth } from '../RequireAuth/RequireAuth'
import { SiteHeader } from './SiteHeader'

// 테스트에선 Supabase 를 끈다 → 인증 상태를 signIn/signOut 으로만 결정론적으로 제어.
// (실제 .env 의 VITE_SUPABASE_* 가 있으면 비동기 getSession 이 상태를 덮어써 불안정해진다.)
vi.mock('../../config/supabase', () => ({ supabase: null, isAuthConfigured: false }))
// 아바타는 이제 /me 를 조회해 그린다 — 실제 fetch 가 나가지 않도록 고정한다.
vi.mock('../../api/auth', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({
    id: 'user-1',
    email: null,
    role: null,
    nickname: null,
    login_provider: null,
    profile_image: null,
  }),
}))

function renderHeader() {
  return render(
    <MemoryRouter>
      <SiteHeader />
    </MemoryRouter>,
  )
}

/** 헤더 + 보호 라우트를 실제 라우터로 묶어 로그아웃 이동을 검증하기 위한 앱 축소판. */
function Layout() {
  return (
    <>
      <SiteHeader />
      <Outlet />
    </>
  )
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<h1>홈 화면</h1>} />
          <Route path="login" element={<h1>로그인 화면</h1>} />
          <Route element={<RequireAuth />}>
            <Route path="chat" element={<h1>채팅 화면</h1>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

function signedIn() {
  signIn('test-token')
}

// 컴포넌트가 마운트되지 않은 시점에 초기화한다(afterEach 로 하면 언마운트 전에
// 상태가 바뀌어 act() 경고가 난다).
beforeEach(() => {
  signOut() // 모듈 세션 스토어 초기화
})

describe('SiteHeader', () => {
  it('비로그인 상태면 로그인 버튼을 보여준다', () => {
    renderHeader()

    expect(screen.getByRole('link', { name: '로그인' })).toHaveAttribute('href', '/login')
    expect(screen.queryByLabelText('내 계정')).not.toBeInTheDocument()
  })

  it('비로그인 상태면 알림 종을 숨긴다', () => {
    renderHeader()

    expect(screen.queryByLabelText('알림')).not.toBeInTheDocument()
  })

  it('로그인 상태면 로그인 버튼 대신 아바타와 알림 종을 보여준다', () => {
    signedIn()

    renderHeader()

    expect(screen.getByLabelText('내 계정')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '로그인' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('알림')).toBeInTheDocument()
  })

  // 카카오 인증만 끝난 사용자도 Supabase 세션은 갖는다(isAuthed=true). 그 상태로
  // 아바타를 보여주면 가입도 하기 전에 "이미 회원" 처럼 보인다.
  it.each(['/signup?mode=kakao', '/auth/callback?code=x'])(
    '가입이 끝나기 전 화면(%s)에서는 세션이 있어도 회원 UI 를 감춘다',
    (path) => {
      signedIn()

      render(
        <MemoryRouter initialEntries={[path]}>
          <SiteHeader />
        </MemoryRouter>,
      )

      expect(screen.queryByLabelText('내 계정')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('알림')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: '로그인' })).toBeInTheDocument()
    },
  )

  it('가입을 마친 뒤 다른 화면에서는 다시 회원 UI 를 보여준다', () => {
    signedIn()

    render(
      <MemoryRouter initialEntries={['/mypage']}>
        <SiteHeader />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('내 계정')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '로그인' })).not.toBeInTheDocument()
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
  })

  it('햄버거를 누르면 서비스 이동 메뉴 3개가 열린다', async () => {
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByLabelText('메뉴 열기'))

    const drawer = screen.getByRole('dialog', { name: '메뉴' })
    expect(within(drawer).getByRole('link', { name: '계약 진단' })).toHaveAttribute(
      'href',
      '/analyze',
    )
    expect(within(drawer).getByRole('link', { name: '위험 보고서' })).toHaveAttribute(
      'href',
      '/risk-report',
    )
    expect(within(drawer).getByRole('link', { name: 'AI 챗봇' })).toHaveAttribute('href', '/chat')
  })

  it('햄버거 메뉴는 서비스 이동만 담당한다 (설정·로그아웃·대화기록 없음)', async () => {
    signedIn()
    const user = userEvent.setup()
    renderHeader()

    await user.click(screen.getByLabelText('메뉴 열기'))

    const drawer = screen.getByRole('dialog', { name: '메뉴' })
    expect(within(drawer).queryByText('설정')).not.toBeInTheDocument()
    expect(within(drawer).queryByText('로그아웃')).not.toBeInTheDocument()
    expect(within(drawer).queryByText('대화기록')).not.toBeInTheDocument()
  })

  it('햄버거 메뉴의 링크를 누르면 이동하고 메뉴가 닫힌다', async () => {
    signedIn()
    const user = userEvent.setup()
    renderApp('/')

    await user.click(screen.getByLabelText('메뉴 열기'))
    await user.click(
      within(screen.getByRole('dialog', { name: '메뉴' })).getByRole('link', { name: 'AI 챗봇' }),
    )

    expect(await screen.findByText('채팅 화면')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '메뉴' })).not.toBeInTheDocument()
  })

  it('보호 화면에서 로그아웃하면 로그인 화면이 아니라 홈으로 이동한다', async () => {
    signedIn()
    const user = userEvent.setup()

    renderApp('/chat')
    expect(screen.getByText('채팅 화면')).toBeInTheDocument()

    await user.click(screen.getByLabelText('내 계정'))
    await user.click(screen.getByRole('menuitem', { name: '로그아웃' }))

    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
    expect(screen.queryByText('로그인 화면')).not.toBeInTheDocument()
    expect(screen.queryByText('채팅 화면')).not.toBeInTheDocument()
    // 홈 도착 후 로그아웃 완료 → 헤더가 로그인 버튼으로 바뀐다
    expect(await screen.findByRole('link', { name: '로그인' })).toBeInTheDocument()
  })
})
