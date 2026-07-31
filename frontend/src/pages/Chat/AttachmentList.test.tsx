import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { AttachmentList, type AttachmentItem } from './AttachmentList'

const pdf: AttachmentItem = { key: 'a', name: '계약서.pdf', kind: 'pdf' }
const image: AttachmentItem = {
  key: 'b',
  name: '등기부.jpg',
  kind: 'image',
  previewUrl: 'blob:preview',
}

describe('AttachmentList', () => {
  it('첨부가 없으면 아무것도 그리지 않는다', () => {
    const { container } = render(<AttachmentList items={[]} variant="composer" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('여러 파일을 이름과 함께 모두 보여준다', () => {
    render(<AttachmentList items={[pdf, image]} variant="composer" />)

    expect(screen.getByText('계약서.pdf')).toBeInTheDocument()
    expect(screen.getByText('등기부.jpg')).toBeInTheDocument()
  })

  it('previewUrl 이 있는 이미지는 썸네일로 그린다', () => {
    render(<AttachmentList items={[image]} variant="composer" />)

    // 파일명이 이미 이름을 말하므로 썸네일은 장식이다(alt="").
    expect(screen.getByRole('presentation')).toHaveAttribute('src', 'blob:preview')
  })

  it('previewUrl 이 없으면 썸네일 대신 아이콘으로 떨어진다', () => {
    // 새로고침 뒤에는 원본이 서버에 없어 이 경로를 탄다.
    render(<AttachmentList items={[{ ...image, previewUrl: undefined }]} variant="composer" />)

    expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
    expect(screen.getByText('등기부.jpg')).toBeInTheDocument()
  })

  it('composer 에서는 각 첨부를 ✕ 로 뺄 수 있다', async () => {
    const onRemove = vi.fn()
    render(<AttachmentList items={[pdf, image]} variant="composer" onRemove={onRemove} />)

    await userEvent.click(screen.getByRole('button', { name: '등기부.jpg 제거' }))

    expect(onRemove).toHaveBeenCalledWith('b')
  })

  it('말풍선 안에서는 제거 버튼을 두지 않는다 — 이미 보낸 기록이다', () => {
    render(<AttachmentList items={[pdf, image]} variant="message" onRemove={vi.fn()} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
