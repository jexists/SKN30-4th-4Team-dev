import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MyPage } from './MyPage'

const useAuth = vi.fn()
const useCurrentUser = vi.fn()
const signOut = vi.fn()
const withdrawMember = vi.hoisted(() => vi.fn())
const listAnalyses = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuth() }))
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: (token: string | null) => useCurrentUser(token),
}))
vi.mock('../../api/auth', () => ({ withdrawMember }))
// 진단 내역은 이 파일의 관심사가 아니다 — 실제 fetch 가 나가지 않도록 빈 목록으로 고정한다.
vi.mock('../../api/analyses', () => ({ listAnalyses }))

describe('MyPage 프로필', () => {
  beforeEach(() => {
    listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
    useAuth.mockReturnValue({ token: 'access-token', signOut })
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
        nickname: '홈실드',
      },
      error: null,
    })
  })

  it('로그인 토큰으로 조회한 회원가입 닉네임을 상단에 표시한다', () => {
    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(useCurrentUser).toHaveBeenCalledWith('access-token')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('홈실드 님')
    expect(screen.queryByText('김철수')).not.toBeInTheDocument()
  })

  it('조회 중에는 기존 화면 위치에 로딩 상태를 표시한다', () => {
    useCurrentUser.mockReturnValue({ status: 'loading', data: null, error: null })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    // 진단 내역 로딩도 role="status" 라 화면 전체에서 찾으면 둘이 잡힌다 — 제목 안에서 찾는다.
    const heading = screen.getByRole('heading', { level: 1 })
    expect(within(heading).getByRole('status')).toHaveTextContent('프로필을 불러오는 중입니다.')
  })
})

describe('MyPage 회원 탈퇴', () => {
  const originalLocation = window.location

  beforeEach(() => {
    listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
    useAuth.mockReturnValue({ token: 'access-token', signOut })
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: { id: 'user-1', email: 'user@example.com', role: 'authenticated', nickname: '홈실드' },
      error: null,
    })
    withdrawMember.mockReset()
    signOut.mockReset()
    withdrawMember.mockResolvedValue({ id: 'user-1', deleted_at: '2026-07-29T00:00:00Z' })

    // 탈퇴 성공은 전체 새로고침으로 빠져나간다 — jsdom 에서는 이동을 가로채 기록만 한다.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, href: '/mypage' },
    })
  })

  /** 모달을 연 뒤 user·dialog 를 돌려준다. 페이지 진입 버튼과 모달 확정 버튼은
   *  이름이 같으므로, 확정 버튼은 반드시 dialog 안에서 찾는다. */
  async function openWithdrawModal() {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: '회원 탈퇴' }))
    const dialog = await screen.findByRole('dialog', { name: '회원 탈퇴' })
    return { user, dialog, confirm: within(dialog).getByRole('button', { name: '회원 탈퇴' }) }
  }

  function agreeCheckbox() {
    return screen.getByLabelText('위 내용을 확인했으며 회원 탈퇴에 동의합니다.')
  }

  it('로그아웃 대신 회원 탈퇴 메뉴를 보여준다', () => {
    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('button', { name: '회원 탈퇴' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '로그아웃' })).not.toBeInTheDocument()
  })

  it('회원 탈퇴를 누르면 되돌릴 수 없다는 확인 모달을 연다', async () => {
    const { dialog } = await openWithdrawModal()

    expect(dialog).toHaveTextContent('정말 회원 탈퇴하시겠습니까?')
    expect(dialog).toHaveTextContent(
      '탈퇴 시 계정 정보와 채팅, 계약서 등 모든 데이터가 삭제되며 복구할 수 없습니다.',
    )
    expect(agreeCheckbox()).toBeInTheDocument()
  })

  it('동의를 체크해야 탈퇴 버튼이 활성화된다', async () => {
    const { user, dialog, confirm } = await openWithdrawModal()

    expect(confirm).toBeDisabled()

    await user.click(agreeCheckbox())
    expect(confirm).toBeEnabled()

    // 다시 해제하면 잠긴다 — 오조작으로 지나가지 않게.
    await user.click(agreeCheckbox())
    expect(confirm).toBeDisabled()
    expect(dialog).toBeInTheDocument()
  })

  it('동의하지 않은 상태에서는 탈퇴 API 를 호출하지 않는다', async () => {
    const { user, confirm } = await openWithdrawModal()

    await user.click(confirm)

    expect(withdrawMember).not.toHaveBeenCalled()
  })

  it('동의 후 탈퇴하면 API 호출·로그아웃·로그인 화면 이동까지 처리한다', async () => {
    const { user, confirm } = await openWithdrawModal()

    await user.click(agreeCheckbox())
    await user.click(confirm)

    await waitFor(() => expect(withdrawMember).toHaveBeenCalledTimes(1))
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/login')
  })

  it('탈퇴에 실패하면 로그아웃하지 않고 모달에 머문다', async () => {
    withdrawMember.mockRejectedValue(new Error('서버 오류'))
    const { user, dialog, confirm } = await openWithdrawModal()

    await user.click(agreeCheckbox())
    await user.click(confirm)

    await waitFor(() => expect(withdrawMember).toHaveBeenCalledTimes(1))
    expect(signOut).not.toHaveBeenCalled()
    expect(window.location.href).toBe('/mypage')
    expect(dialog).toBeInTheDocument()
    // 다시 시도할 수 있도록 버튼이 되돌아온다.
    await waitFor(() => expect(confirm).toBeEnabled())
  })

  it('모달을 취소하고 다시 열면 동의 체크가 초기화된다', async () => {
    const { user, dialog } = await openWithdrawModal()

    await user.click(agreeCheckbox())
    await user.click(within(dialog).getByRole('button', { name: '취소' }))

    await user.click(screen.getByRole('button', { name: '회원 탈퇴' }))

    expect(agreeCheckbox()).not.toBeChecked()
  })
})
