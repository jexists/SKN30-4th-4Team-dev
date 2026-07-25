import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MarkdownMessage } from './MarkdownMessage'

describe('MarkdownMessage', () => {
  it('헤딩·리스트·표·코드블록(복사 버튼)을 렌더한다', () => {
    const md = [
      '# 제목',
      '',
      '- 항목 하나',
      '- 항목 둘',
      '',
      '| A | B |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '```',
      'const x = 1',
      '```',
    ].join('\n')

    render(<MarkdownMessage content={md} />)

    expect(screen.getByRole('heading', { name: '제목' })).toBeInTheDocument()
    expect(screen.getByText('항목 하나')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    // 한 줄짜리 펜스 코드블록도 인라인이 아니라 CodeBlock(복사 버튼)으로 렌더돼야 한다.
    expect(screen.getByRole('button', { name: '코드 복사' })).toBeInTheDocument()
    expect(screen.getByText('const x = 1')).toBeInTheDocument()
  })

  it('인라인 코드는 복사 버튼 없이 렌더한다', () => {
    render(<MarkdownMessage content={'문장 안 `코드` 조각'} />)
    expect(screen.getByText('코드')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '코드 복사' })).not.toBeInTheDocument()
  })
})
