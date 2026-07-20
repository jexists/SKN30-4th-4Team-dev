import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { HealthStatus } from './HealthStatus'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HealthStatus', () => {
  it('연결 성공 시 "백엔드 연결됨" 을 표시한다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
          success: true,
          code: 200,
          message: 'OK',
          data: { status: 'ok', db: 'ok' },
          error: null,
        }),
      }),
    )

    render(<HealthStatus />)

    expect(await screen.findByText('백엔드 연결됨')).toBeInTheDocument()
  })

  it('연결 실패 시 "백엔드 연결 실패" 를 표시한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))

    render(<HealthStatus />)

    expect(await screen.findByText('백엔드 연결 실패')).toBeInTheDocument()
  })
})
