import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRegistration = vi.hoisted(() => vi.fn())
const setKakaoReturnTo = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())

/** 실제 useAuth 처럼 구독 가능한 세션 스토어 — signOut 이 리렌더까지 일으켜야
 *  '로그아웃 후 어디로 가는가' 를 검증할 수 있다. */
const authStore = vi.hoisted(() => {
  let authed = true
  const listeners = new Set<() => void>()
  return {
    isAuthed: () => authed,
    reset: () => {
      authed = true
    },
    signOut: () => {
      authed = false
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
})

vi.mock('../../api/kakaoAuth', () => ({ getRegistration }))
vi.mock('../../auth/kakaoOAuth', () => ({ setKakaoReturnTo }))
vi.mock('../../config/supabase', () => ({ supabase: {}, isAuthConfigured: true }))
vi.mock('../../hooks/useAuth', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    signOut: () => {
      signOut()
      authStore.signOut()
    },
    useAuth: () => ({
      isAuthed: useSyncExternalStore(authStore.subscribe, authStore.isAuthed),
      isLoading: false,
      sessionExpired: false,
    }),
  }
})

import { ApiError } from '../../api/apiError'
import { RequireAuth } from './RequireAuth'

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={['/mypage?tab=profile']}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/mypage" element={<h1>마이페이지</h1>} />
        </Route>
        <Route path="/signup" element={<h1>카카오 회원가입</h1>} />
        <Route path="/login" element={<h1>로그인</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 채팅 화면 대역 — 마운트 횟수를 세고, URL 만 바꾸는 이동 버튼을 노출한다. */
function ChatStub({ onMount }: { onMount: () => void }) {
  const navigate = useNavigate()
  const { chatId } = useParams<{ chatId: string }>()

  useEffect(onMount, [onMount])

  return (
    <>
      <h1>채팅 화면</h1>
      <span data-testid="chat-id">{chatId ?? ''}</span>
      <button onClick={() => navigate('/chat/room-1')}>대화 열기</button>
    </>
  )
}

describe('RequireAuth registration guard', () => {
  beforeEach(() => {
    getRegistration.mockReset()
    setKakaoReturnTo.mockReset()
    signOut.mockReset()
    authStore.reset()
  })

  it('가입이 완료된 사용자는 보호 화면을 보여준다', async () => {
    getRegistration.mockResolvedValue({ status: 'authenticated' })

    renderGuard()

    expect(await screen.findByText('마이페이지')).toBeInTheDocument()
  })

  it('JWT만 있고 앱 회원이 아니면 카카오 가입 화면으로 보낸다', async () => {
    getRegistration.mockResolvedValue({ status: 'signup_required' })

    renderGuard()

    expect(await screen.findByText('카카오 회원가입')).toBeInTheDocument()
    expect(setKakaoReturnTo).toHaveBeenCalledWith('/mypage?tab=profile')
  })

  // 탈퇴해도 Supabase 세션은 만료 전까지 살아 있다. 다른 탭이나 다른 기기에 남아 있던
  // 세션으로 보호 화면에 들어오면, 가입 화면이 아니라 로그아웃으로 끊어내야 한다.
  it('탈퇴한 계정(403)은 가입 화면이 아니라 로그아웃 후 로그인 화면으로 보낸다', async () => {
    getRegistration.mockRejectedValue(new ApiError('탈퇴한 계정', '탈퇴 처리된 계정입니다.', 403))

    renderGuard()

    expect(await screen.findByText('로그인')).toBeInTheDocument()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(setKakaoReturnTo).not.toHaveBeenCalled()
    expect(screen.queryByText('카카오 회원가입')).not.toBeInTheDocument()
  })

  it('가입 확인 자체가 실패하면 로그아웃시키지 않고 재시도 안내를 보여준다', async () => {
    getRegistration.mockRejectedValue(new ApiError('일시적인 접속 지연', '잠시 후 다시', 503))

    renderGuard()

    expect(await screen.findByRole('alert')).toHaveTextContent('회원 정보를 확인하지 못했습니다')
    expect(signOut).not.toHaveBeenCalled()
  })

  // /chat → /chat/:chatId 처럼 URL 만 바뀔 때 가드가 다시 'checking' 으로 돌아가면
  // <Outlet /> 이 사라져 보호 화면이 리마운트된다(채팅이 새로고침된 것처럼 깜빡이고
  // 진행 중이던 대화가 날아갔다). 가입 여부는 경로와 무관하므로 다시 확인하지 않는다.
  it('같은 라우트에서 URL 만 바뀌면 보호 화면을 리마운트하지 않는다', async () => {
    getRegistration.mockResolvedValue({ status: 'authenticated' })
    const onMount = vi.fn()
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes>
          <Route element={<RequireAuth />}>
            <Route path="/chat/:chatId?" element={<ChatStub onMount={onMount} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('채팅 화면')).toBeInTheDocument()
    expect(onMount).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '대화 열기' }))

    expect(screen.getByTestId('chat-id')).toHaveTextContent('room-1')
    expect(onMount).toHaveBeenCalledTimes(1) // 같은 인스턴스가 그대로 살아 있다
    expect(getRegistration).toHaveBeenCalledTimes(1)
  })
})
