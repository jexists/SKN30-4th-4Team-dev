import { StrictMode, type PropsWithChildren } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CurrentUser } from '../api/auth'
import { useCurrentUser } from './useCurrentUser'

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }))

vi.mock('../api/auth', () => ({ getCurrentUser }))

const USER: CurrentUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'authenticated',
  nickname: '홈실드',
  login_provider: 'email',
  profile_image: null,
  notify_report_complete: true,
}

function StrictModeWrapper({ children }: PropsWithChildren) {
  return <StrictMode>{children}</StrictMode>
}

describe('useCurrentUser', () => {
  it('StrictMode에서 마이페이지가 다시 마운트돼도 현재 사용자 API를 한 번만 호출한다', async () => {
    getCurrentUser.mockResolvedValueOnce(USER)

    const { result } = renderHook(() => useCurrentUser('access-token'), {
      wrapper: StrictModeWrapper,
    })

    await waitFor(() => expect(result.current.status).toBe('ok'))

    expect(result.current.data?.nickname).toBe('홈실드')
    expect(getCurrentUser).toHaveBeenCalledTimes(1)
  })

  it('한 화면에서 프로필을 갱신하면 다른 곳(헤더 아바타)도 함께 갱신된다', async () => {
    getCurrentUser.mockResolvedValue(USER)

    // 마이페이지와 헤더처럼 같은 사용자를 보는 두 구독자.
    const page = renderHook(() => useCurrentUser('shared-token'))
    const header = renderHook(() => useCurrentUser('shared-token'))

    await waitFor(() => expect(header.result.current.status).toBe('ok'))

    act(() => {
      page.result.current.setCurrentUser({ ...USER, profile_image: 'https://cdn/new.png' })
    })

    expect(header.result.current.data?.profile_image).toBe('https://cdn/new.png')
  })
})
