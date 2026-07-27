import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnalyzeDocumentsResponse } from '../../api/documents'
import { Analyze } from './Analyze'

const api = vi.hoisted(() => ({
  analyzeDocuments: vi.fn(),
}))

vi.mock('../../api/documents', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api/documents')>()
  return { ...original, analyzeDocuments: api.analyzeDocuments }
})

const result: AnalyzeDocumentsResponse = {
  contract: {
    status: 'completed',
    error: null,
    data: {
      mode: 'contract_bundle',
      source_file: 'contract.pdf',
      page_count: 2,
      mask_count: 3,
      coarse_mask_count: 0,
      review_required: true,
      missing_doc_types: ['mutual_aid'],
      warnings: [],
      ocr_pages: [
        {
          page: 1,
          width: 1000,
          height: 1400,
          text: '임대차계약서 보증금 금 이억원정',
          method: 'text',
        },
      ],
      documents: [
        {
          doc_type: 'lease_contract',
          source_file: 'contract.pdf',
          page_count: 1,
          parsed_at: '2026-07-26T12:00:00+09:00',
          parser_version: '1.0.0',
          overall_confidence: 0.93,
          warnings: [],
          fields: {
            deposit: {
              value: 200000000,
              raw: '금 이억원정',
              status: 'extracted',
              confidence: 0.95,
              page: 1,
              bbox: [10, 20, 30, 40],
              method: 'text',
            },
            lessor_name: {
              value: null,
              raw: null,
              status: 'unreadable',
              confidence: 0.62,
              page: 1,
              bbox: [50, 60, 70, 80],
              method: 'ocr',
            },
          },
        },
      ],
    },
  },
  registry: null,
  engine_input: {
    contract: { deposit: 200000000 },
    unknowns: ['lessor_name'],
  },
}

function renderAnalyze() {
  return render(
    <MemoryRouter>
      <Analyze />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.analyzeDocuments.mockResolvedValue(result)
})

describe('Analyze OCR flow', () => {
  it('계약 서류가 있어야 분석하고 구조화 결과와 OCR 원문을 모달에 표시한다', async () => {
    const user = userEvent.setup()
    renderAnalyze()

    const analyzeButton = screen.getByRole('button', { name: 'OCR 분석 시작' })
    expect(analyzeButton).toBeDisabled()

    const contract = new File(['contract'], 'contract.pdf', { type: 'application/pdf' })
    await user.upload(document.querySelector('#upload-contract') as HTMLInputElement, contract)

    expect(screen.getByText('contract.pdf')).toBeInTheDocument()
    expect(analyzeButton).toBeEnabled()
    await user.click(analyzeButton)

    await waitFor(() => {
      expect(api.analyzeDocuments).toHaveBeenCalledWith(contract, undefined)
    })
    const dialog = await screen.findByRole('dialog', { name: 'OCR 추출 결과' })
    expect(dialog).toHaveTextContent('임대차계약서')
    expect(dialog).toHaveTextContent('200,000,000')
    expect(dialog).toHaveTextContent('인식 불가')
    expect(dialog).toHaveTextContent('찾지 못한 문서: 공제증서')

    await user.click(screen.getByRole('button', { name: 'OCR 원문 보기' }))
    expect(dialog).toHaveTextContent('임대차계약서 보증금 금 이억원정')
  })

  it('지원하지 않는 파일은 API를 호출하지 않고 안내한다', async () => {
    renderAnalyze()

    const textFile = new File(['plain'], 'contract.txt', { type: 'text/plain' })
    const dropzone = screen.getAllByText('파일을 드래그하거나 클릭하여 업로드')[0].closest('label')
    fireEvent.drop(dropzone as HTMLLabelElement, { dataTransfer: { files: [textFile] } })

    expect(screen.getByText('PDF, JPG 또는 PNG 파일만 선택해 주세요.')).toBeInTheDocument()
    expect(api.analyzeDocuments).not.toHaveBeenCalled()
  })
})
