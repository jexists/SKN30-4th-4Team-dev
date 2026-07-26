import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Drawer } from './Drawer'

describe('Drawer', () => {
  it('open 이 false 면 아무것도 렌더하지 않는다', () => {
    render(
      <Drawer open={false} onClose={() => {}} title="메뉴">
        <p>내용</p>
      </Drawer>,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('제목과 내용을 보여주고 제목으로 라벨링한다', () => {
    render(
      <Drawer open onClose={() => {}} title="대화기록">
        <p>내용</p>
      </Drawer>,
    )

    expect(screen.getByRole('dialog', { name: '대화기록' })).toHaveTextContent('내용')
  })

  it('닫기 버튼을 누르면 onClose 를 호출한다', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Drawer open onClose={onClose} title="메뉴">
        <p>내용</p>
      </Drawer>,
    )

    await user.click(screen.getByRole('button', { name: '닫기' }))

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('ESC 로 닫는다', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Drawer open onClose={onClose} title="메뉴">
        <p>내용</p>
      </Drawer>,
    )

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('백드롭을 누르면 닫히지만 내용 클릭은 닫히지 않는다', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Drawer open onClose={onClose} title="메뉴">
        <p>내용</p>
      </Drawer>,
    )

    await user.click(screen.getByText('내용'))
    expect(onClose).not.toHaveBeenCalled()

    // 백드롭은 다이얼로그의 부모다.
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('열려 있는 동안 배경 스크롤을 잠그고 닫히면 되돌린다', () => {
    const { rerender } = render(
      <Drawer open onClose={() => {}} title="메뉴">
        <p>내용</p>
      </Drawer>,
    )
    expect(document.body.style.overflow).toBe('hidden')

    rerender(
      <Drawer open={false} onClose={() => {}} title="메뉴">
        <p>내용</p>
      </Drawer>,
    )
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
