import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MyPage } from './MyPage'

const useAuth = vi.fn()
const useCurrentUser = vi.fn()
const signOut = vi.fn()
const withdrawMember = vi.hoisted(() => vi.fn())
const updateNickname = vi.hoisted(() => vi.fn())
const uploadAvatar = vi.hoisted(() => vi.fn())
const listAnalyses = vi.hoisted(() => vi.fn())
const listRooms = vi.hoisted(() => vi.fn())
const setCurrentUser = vi.fn()
const signInWithPassword = vi.hoisted(() => vi.fn())
const updateUser = vi.hoisted(() => vi.fn())

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => useAuth() }))
vi.mock('../../hooks/useCurrentUser', () => ({
  useCurrentUser: (token: string | null) => useCurrentUser(token),
}))
vi.mock('../../api/auth', () => ({ withdrawMember, updateNickname, uploadAvatar }))
// 진단 내역은 이 파일의 관심사가 아니다 — 실제 fetch 가 나가지 않도록 빈 목록으로 고정한다.
vi.mock('../../api/analyses', () => ({ listAnalyses }))
// 상담 내역도 마찬가지 — 실제 fetch 가 나가지 않도록 빈 목록으로 고정한다.
vi.mock('../../api/chatHistory', () => ({ listRooms }))
// 비밀번호 변경은 Supabase Auth 를 직접 호출한다 — 실제 네트워크 대신 목으로 검증한다.
vi.mock('../../config/supabase', () => ({
  supabase: { auth: { signInWithPassword, updateUser } },
}))

describe('MyPage 프로필', () => {
  beforeEach(() => {
    listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
    listRooms.mockResolvedValue({ items: [], next_cursor: null })
    useAuth.mockReturnValue({ token: 'access-token', signOut })
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
        nickname: '홈실드',
        login_provider: 'email',
      },
      error: null,
      setCurrentUser,
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

  it('프로필 사진을 고르면 업로드하고, 성공하면 화면에 반영된다', async () => {
    const user = userEvent.setup()
    uploadAvatar.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
      nickname: '홈실드',
      login_provider: 'email',
      profile_image: 'https://cdn.example/avatar.png',
    })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    const file = new File(['fake-bytes'], 'avatar.png', { type: 'image/png' })
    const input = screen.getByLabelText('프로필 사진 변경', { selector: 'input' })
    await user.upload(input, file)

    await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith(file))
    expect(setCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ profile_image: 'https://cdn.example/avatar.png' }),
    )
  })

  it('로그인 경로를 표시한다', () => {
    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(screen.getByText('로그인 경로')).toBeInTheDocument()
    expect(screen.getByText('이메일')).toBeInTheDocument()
  })

  it('닉네임 수정 버튼을 누르면 모달이 열리고, 저장하면 새 닉네임이 화면에 반영된다', async () => {
    const user = userEvent.setup()
    updateNickname.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      role: 'authenticated',
      nickname: '새닉네임',
      login_provider: 'email',
    })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: '수정' }))
    const dialog = await screen.findByRole('dialog', { name: '닉네임 변경' })
    const input = within(dialog).getByLabelText('닉네임')
    await user.clear(input)
    await user.type(input, '새닉네임')
    await user.click(within(dialog).getByRole('button', { name: '저장' }))

    await waitFor(() => expect(updateNickname).toHaveBeenCalledWith('새닉네임'))
    expect(setCurrentUser).toHaveBeenCalledWith(
      expect.objectContaining({ nickname: '새닉네임' }),
    )
    expect(screen.queryByRole('dialog', { name: '닉네임 변경' })).not.toBeInTheDocument()
  })

  it('조회 중에는 기존 화면 위치에 로딩 상태를 표시한다', () => {
    useCurrentUser.mockReturnValue({ status: 'loading', data: null, error: null, setCurrentUser })

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

describe('MyPage 최근 상담 내역', () => {
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
        login_provider: 'email',
      },
      error: null,
      setCurrentUser,
    })
  })

  it('전체보기 버튼을 누르면 AI 챗봇 화면으로 이동한다', () => {
    listRooms.mockResolvedValue({ items: [], next_cursor: null })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: '전체보기' })).toHaveAttribute('href', '/chat')
  })

  it('DB 에서 받은 채팅방을 축약 ID·제목·미리보기·이어하기 링크로 보여준다', async () => {
    listRooms.mockResolvedValue({
      items: [
        {
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          title: '임대인 세금 체납 관련 법적 효력',
          last_chat_at: '2026-07-30T10:00:00Z',
          updated_at: '2026-07-30T10:00:00Z',
          last_message_preview: '현재 분석 중인 계약서 4조 2항의 특약 사항이 임차인에게 다소 불리하게',
        },
      ],
      next_cursor: null,
    })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('# 상담 ID: 3FA85F64')).toBeInTheDocument()
    expect(screen.getByText('임대인 세금 체납 관련 법적 효력')).toBeInTheDocument()
    expect(
      screen.getByText('"현재 분석 중인 계약서 4조 2항의 특약 사항이 임차인에게 다소 불리하게"'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /상담 이어서 하기/ })).toHaveAttribute(
      'href',
      '/chat/3fa85f64-5717-4562-b3fc-2c963f66afa6',
    )
  })

  it('제목·미리보기가 없는 방은 기본 문구로 대신한다', async () => {
    listRooms.mockResolvedValue({
      items: [
        {
          id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
          title: null,
          last_chat_at: '2026-07-30T10:00:00Z',
          updated_at: '2026-07-30T10:00:00Z',
          last_message_preview: null,
        },
      ],
      next_cursor: null,
    })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('새 상담')).toBeInTheDocument()
    expect(screen.getByText('아직 대화 내용이 없습니다.')).toBeInTheDocument()
  })

  it('상담이 하나도 없으면 빈 상태 문구를 보여준다', async () => {
    listRooms.mockResolvedValue({ items: [], next_cursor: null })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('아직 진행한 상담이 없습니다. 챗봇에게 물어보면 이곳에 기록이 쌓입니다.'),
    ).toBeInTheDocument()
  })

  it('조회에 실패하면 공통 오류 상태와 재시도 버튼을 보여준다', async () => {
    listRooms.mockRejectedValue(new Error('network error'))

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('상담 내역을 불러오지 못했습니다.')).toBeInTheDocument()
  })
})

describe('MyPage 최근 진단 내역 — 더 보기', () => {
  beforeEach(() => {
    listRooms.mockResolvedValue({ items: [], next_cursor: null })
    useAuth.mockReturnValue({ token: 'access-token', signOut })
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
        nickname: '홈실드',
        login_provider: 'email',
      },
      error: null,
      setCurrentUser,
    })
  })

  function job(id: string, title: string) {
    return {
      id,
      status: 'FAILED' as const,
      stage: null,
      progress: 0,
      file_names: ['1-전세계약.pdf'],
      title,
      risk_level: null,
      created_at: '2026-07-30T11:23:00Z',
      finished_at: null,
    }
  }

  it('다음 페이지가 있으면 더 보기 버튼을 보여주고, 누르면 다음 페이지를 이어붙인다', async () => {
    const user = userEvent.setup()
    listAnalyses.mockResolvedValueOnce({
      items: [job('job-1', '첫 페이지'), job('job-2', '첫 페이지 2')],
      next_cursor: 'cursor-1',
    })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('첫 페이지')).toBeInTheDocument()
    const loadMoreBtn = screen.getByRole('button', { name: '더 보기' })

    listAnalyses.mockResolvedValueOnce({
      items: [job('job-3', '두 번째 페이지')],
      next_cursor: null,
    })
    await user.click(loadMoreBtn)

    expect(await screen.findByText('두 번째 페이지')).toBeInTheDocument()
    expect(screen.getByText('첫 페이지')).toBeInTheDocument()
    expect(listAnalyses).toHaveBeenLastCalledWith('cursor-1', 5)
    // 더 가져올 페이지가 없으면 버튼이 사라진다.
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })

  it('다음 페이지가 없으면 더 보기 버튼을 보여주지 않는다', async () => {
    listAnalyses.mockResolvedValueOnce({
      items: [job('job-1', '유일한 항목')],
      next_cursor: null,
    })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('유일한 항목')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })
})

describe('MyPage 비밀번호 변경', () => {
  beforeEach(() => {
    listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
    listRooms.mockResolvedValue({ items: [], next_cursor: null })
    useAuth.mockReturnValue({ token: 'access-token', signOut })
    signInWithPassword.mockReset()
    updateUser.mockReset()
  })

  it('카카오 로그인 계정에는 비밀번호 변경 섹션이 보이지 않는다', () => {
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: null,
        role: 'authenticated',
        nickname: '홈실드',
        login_provider: 'kakao',
      },
      error: null,
      setCurrentUser,
    })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    expect(screen.queryByText('비밀번호 변경')).not.toBeInTheDocument()
  })

  it('이메일 로그인 계정은 현재 비밀번호 재인증 후 Supabase Auth 로 새 비밀번호를 저장한다', async () => {
    const user = userEvent.setup()
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
        nickname: '홈실드',
        login_provider: 'email',
      },
      error: null,
      setCurrentUser,
    })
    signInWithPassword.mockResolvedValue({ data: {}, error: null })
    updateUser.mockResolvedValue({ data: {}, error: null })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: '변경' }))
    const dialog = await screen.findByRole('dialog', { name: '비밀번호 변경' })
    await user.type(within(dialog).getByLabelText('현재 비밀번호'), 'oldpass123')
    await user.type(within(dialog).getByLabelText('새 비밀번호'), 'newpass123')
    await user.type(within(dialog).getByLabelText('새 비밀번호 확인'), 'newpass123')
    await user.click(within(dialog).getByRole('button', { name: '변경' }))

    await waitFor(() =>
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: 'user@example.com',
        password: 'oldpass123',
      }),
    )
    expect(updateUser).toHaveBeenCalledWith({ password: 'newpass123' })
    expect(screen.queryByRole('dialog', { name: '비밀번호 변경' })).not.toBeInTheDocument()
  })

  it('현재 비밀번호가 틀리면 새 비밀번호로 업데이트를 시도하지 않는다', async () => {
    const user = userEvent.setup()
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
        nickname: '홈실드',
        login_provider: 'email',
      },
      error: null,
      setCurrentUser,
    })
    signInWithPassword.mockResolvedValue({ data: null, error: new Error('invalid credentials') })

    render(
      <MemoryRouter>
        <MyPage />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: '변경' }))
    const dialog = await screen.findByRole('dialog', { name: '비밀번호 변경' })
    await user.type(within(dialog).getByLabelText('현재 비밀번호'), 'wrongpass')
    await user.type(within(dialog).getByLabelText('새 비밀번호'), 'newpass123')
    await user.type(within(dialog).getByLabelText('새 비밀번호 확인'), 'newpass123')
    await user.click(within(dialog).getByRole('button', { name: '변경' }))

    await waitFor(() => expect(signInWithPassword).toHaveBeenCalledTimes(1))
    expect(updateUser).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '비밀번호 변경' })).toBeInTheDocument()
  })
})

describe('MyPage 회원 탈퇴', () => {
  const originalLocation = window.location

  beforeEach(() => {
    listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
    listRooms.mockResolvedValue({ items: [], next_cursor: null })
    useAuth.mockReturnValue({ token: 'access-token', signOut })
    useCurrentUser.mockReturnValue({
      status: 'ok',
      data: {
        id: 'user-1',
        email: 'user@example.com',
        role: 'authenticated',
        nickname: '홈실드',
        login_provider: 'email',
      },
      error: null,
      setCurrentUser,
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
