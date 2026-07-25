import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ErrorState } from './ErrorState'

describe('ErrorState', () => {
  it('전달한 문구를 alert 로 알린다', () => {
    render(<ErrorState message="대화 기록을 불러오지 못했습니다." />)

    expect(screen.getByRole('alert')).toHaveTextContent('대화 기록을 불러오지 못했습니다.')
  })

  it('onRetry 를 주면 다시 시도 버튼이 붙고 눌리면 실행된다', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<ErrorState onRetry={onRetry} />)

    await user.click(screen.getByRole('button', { name: '다시 시도' }))

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('onRetry 가 없으면 다시 시도 버튼을 내지 않는다', () => {
    // 404 처럼 다시 눌러도 결과가 같은 실패에서 사용자를 헛돌게 하지 않는다.
    render(<ErrorState message="이미 삭제된 대화입니다." />)

    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })
})
