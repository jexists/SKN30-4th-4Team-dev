import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiPostForm } from './client'
import { analyzeDocuments } from './documents'

vi.mock('./client', () => ({
  apiPostForm: vi.fn(),
}))

describe('analyzeDocuments', () => {
  beforeEach(() => {
    vi.mocked(apiPostForm).mockReset()
  })

  it('세 서류를 같은 file 필드로 반복 전송한다', async () => {
    vi.mocked(apiPostForm).mockResolvedValue({} as never)
    const documents = [
      new File(['register'], 'register.pdf', { type: 'application/pdf' }),
      new File(['contract'], 'contract.pdf', { type: 'application/pdf' }),
      new File(['building'], 'building.pdf', { type: 'application/pdf' }),
    ]

    await analyzeDocuments(documents)

    expect(apiPostForm).toHaveBeenCalledOnce()
    const [path, body] = vi.mocked(apiPostForm).mock.calls[0]
    expect(path).toBe('/api/v1/documents/analyze')
    expect(body.getAll('file')).toEqual(documents)
  })
})
