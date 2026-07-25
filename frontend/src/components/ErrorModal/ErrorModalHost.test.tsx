import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { ErrorModalHost } from './ErrorModalHost'
import { dismissError, showError } from './errorModalStore'

// 모듈 싱글턴 스토어라 각 테스트 후 초기화한다.
afterEach(() => {
  act(() => dismissError())
})

describe('ErrorModalHost', () => {
  it('오류가 없으면 아무것도 보이지 않는다', () => {
    render(<ErrorModalHost />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('showError 를 호출하면 error 타이틀과 메시지를 모달로 보여준다', () => {
    render(<ErrorModalHost />)

    act(() => showError('HISTORY_UNAVAILABLE', '대화 기록 저장소가 설정되지 않았습니다.'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('HISTORY_UNAVAILABLE')
    expect(dialog).toHaveTextContent('대화 기록 저장소가 설정되지 않았습니다.')
  })

  it('닫기 버튼을 누르면 모달이 사라진다', async () => {
    const user = userEvent.setup()
    render(<ErrorModalHost />)
    act(() => showError('ERROR', '문제가 발생했습니다.'))

    await user.click(screen.getByRole('button', { name: '닫기' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('error.message 가 비어 있으면 제목만 보여준다', () => {
    render(<ErrorModalHost />)

    act(() => showError('권한 없음', ''))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('권한 없음')
    // 빈 본문 문단을 그리면 제목 아래에 의미 없는 여백이 남는다.
    expect(dialog.querySelector('p')).toBeNull()
  })

  it('재시도는 모달이 아니라 실패한 영역의 ErrorState 가 맡는다', () => {
    render(<ErrorModalHost />)

    act(() => showError('서버 오류', '잠시 후 다시 시도해 주세요.'))

    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
  })

  it('오류가 연달아 나면 마지막 오류로 덮어쓴다', () => {
    render(<ErrorModalHost />)

    act(() => showError('FIRST', '첫 오류'))
    act(() => showError('SECOND', '두 번째 오류'))

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('SECOND')
    expect(dialog).not.toHaveTextContent('첫 오류')
  })
})
