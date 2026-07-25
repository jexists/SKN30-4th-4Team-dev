import { StrictMode, type PropsWithChildren } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useCurrentUser } from './useCurrentUser'

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }))

vi.mock('../api/auth', () => ({ getCurrentUser }))

const USER = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'authenticated',
  nickname: '홈실드',
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
})
