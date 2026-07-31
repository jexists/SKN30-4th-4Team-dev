import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ChatComposer } from './ChatComposer'
import type { PendingFile } from './types'

const noop = vi.fn()

function pending(name: string, kind: PendingFile['kind'] = 'pdf'): PendingFile {
  return { key: name, file: new File(['x'], name), kind }
}

function renderComposer(props: Partial<Parameters<typeof ChatComposer>[0]> = {}) {
  const merged = {
    value: '',
    onChange: noop,
    onSubmit: noop,
    disabled: false,
    maxLength: 2000,
    pendingFiles: [] as PendingFile[],
    onPickFiles: noop,
    onRemovePendingFile: noop,
    roomAttachment: null,
    onDetachRoomDocument: noop,
    ...props,
  }
  return { ...render(<ChatComposer {...merged} />), props: merged }
}

describe('ChatComposer 첨부', () => {
  it('고른 파일을 한 번에 모두 올려보낸다', async () => {
    const onPickFiles = vi.fn()
    renderComposer({ onPickFiles })

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.multiple).toBe(true)
    await userEvent.upload(input, [
      new File(['a'], '계약서.pdf', { type: 'application/pdf' }),
      new File(['b'], '등기부.jpg', { type: 'image/jpeg' }),
    ])

    expect(onPickFiles).toHaveBeenCalledTimes(1)
    expect(onPickFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual([
      '계약서.pdf',
      '등기부.jpg',
    ])
  })

  it('전송 전 프리뷰에서 첨부를 하나씩 뺄 수 있다', async () => {
    const onRemovePendingFile = vi.fn()
    renderComposer({
      pendingFiles: [pending('계약서.pdf'), pending('등기부.jpg', 'image')],
      onRemovePendingFile,
    })

    expect(screen.getByText('계약서.pdf')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '등기부.jpg 제거' }))

    expect(onRemovePendingFile).toHaveBeenCalledWith('등기부.jpg')
  })

  it('첨부만 있고 글이 없어도 보낼 수 있다', async () => {
    const onSubmit = vi.fn()
    renderComposer({ value: '', pendingFiles: [pending('계약서.pdf')], onSubmit })

    await userEvent.click(screen.getByRole('button', { name: '전송' }))

    expect(onSubmit).toHaveBeenCalled()
  })

  it('첨부도 글도 없으면 전송을 막는다', () => {
    renderComposer({ value: '   ', pendingFiles: [] })

    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()
  })

  it('첨부 버튼은 전송 중일 때만 잠긴다 — 고르는 것 자체는 업로드가 아니다', () => {
    const { unmount } = renderComposer({ pendingFiles: [pending('계약서.pdf')] })
    expect(screen.getByRole('button', { name: '파일 첨부' })).toBeEnabled()
    unmount()

    renderComposer({ disabled: true })
    expect(screen.getByRole('button', { name: '파일 첨부' })).toBeDisabled()
  })

  it('참고 중인 계약서는 개수와 함께 배지로 보이고 해제할 수 있다', async () => {
    const onDetachRoomDocument = vi.fn()
    renderComposer({
      roomAttachment: { fileNames: ['계약서.pdf', '등기부.jpg'] },
      onDetachRoomDocument,
    })

    expect(screen.getByText(/계약서\.pdf 외 1개/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '참고 중인 계약서 해제' }))

    expect(onDetachRoomDocument).toHaveBeenCalled()
  })
})
