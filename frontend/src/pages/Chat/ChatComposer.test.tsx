import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatComposer } from './ChatComposer'

const showToast = vi.hoisted(() => vi.fn())
vi.mock('../../components/Toast/toastStore', () => ({ showToast }))

function setup() {
  const onAttach = vi.fn()
  const onSubmit = vi.fn()
  render(
    <ChatComposer
      value=""
      onChange={() => {}}
      onSubmit={onSubmit}
      disabled={false}
      maxLength={1000}
      attachment={null}
      onAttach={onAttach}
      onRemoveAttachment={() => {}}
    />,
  )
  return { onAttach, onSubmit }
}

describe('ChatComposer 계약서 첨부 버튼', () => {
  beforeEach(() => {
    showToast.mockReset()
  })

  it('클릭하면 준비 중 안내를 한 번 띄운다', async () => {
    const user = userEvent.setup()
    setup()

    await user.click(screen.getByRole('button', { name: '계약서 첨부' }))

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('OCR 첨부 기능은 준비 중입니다.', 'info')
  })

  it('클릭만으로 업로드(onAttach)를 시작하지 않는다', async () => {
    const user = userEvent.setup()
    const { onAttach } = setup()

    await user.click(screen.getByRole('button', { name: '계약서 첨부' }))

    expect(onAttach).not.toHaveBeenCalled()
  })

  it('파일 선택창을 열지 않는다', async () => {
    const user = userEvent.setup()
    // 안내만 하는 버튼이므로 숨은 file input 이 열려선 안 된다.
    const click = vi.spyOn(HTMLInputElement.prototype, 'click')
    setup()

    await user.click(screen.getByRole('button', { name: '계약서 첨부' }))

    expect(click).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('키보드로도 같은 안내가 나온다', async () => {
    const user = userEvent.setup()
    const { onAttach } = setup()

    screen.getByRole('button', { name: '계약서 첨부' }).focus()
    await user.keyboard('{Enter}')

    expect(showToast).toHaveBeenCalledWith('OCR 첨부 기능은 준비 중입니다.', 'info')
    expect(onAttach).not.toHaveBeenCalled()
  })
})
