import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetNotificationStoreForTests } from '../../hooks/useNotifications'
import { Analyze } from './Analyze'

const startAnalysis = vi.hoisted(() => vi.fn())

vi.mock('../../api/analyses', () => ({
  startAnalysis,
  getAnalysis: vi.fn(),
  listAnalyses: vi.fn(),
}))
vi.mock('../../api/notifications', () => ({
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markNotificationsRead: vi.fn(),
  deleteNotifications: vi.fn(),
}))

const INPUT_IDS = ['upload-contract', 'upload-register', 'upload-building-register']

function renderAnalyze() {
  return render(
    <MemoryRouter initialEntries={['/analyze']}>
      <Routes>
        <Route path="/analyze" element={<Analyze />} />
        <Route path="/chat" element={<h1>상담 화면</h1>} />
        <Route path="/risk-report/:jobId" element={<h1>결과 화면</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** 세 카드에 각각 PDF 를 한 장씩 올린다 — 진단 버튼은 세 종류가 다 차야 열린다. */
async function uploadAllSlots(user: ReturnType<typeof userEvent.setup>) {
  for (const id of INPUT_IDS) {
    const input = document.getElementById(id) as HTMLInputElement
    await user.upload(input, new File(['%PDF-1.4'], `${id}.pdf`, { type: 'application/pdf' }))
  }
}

beforeEach(() => {
  startAnalysis.mockResolvedValue({ id: 'job-1', status: 'QUEUED', created_at: '2026-07-30T00:00:00Z' })
})

afterEach(() => {
  __resetNotificationStoreForTests()
  vi.clearAllMocks()
})

describe('Analyze 분석 접수', () => {
  it('서류가 다 차기 전에는 진단 버튼이 잠겨 있다', () => {
    renderAnalyze()

    expect(screen.getByRole('button', { name: 'OCR 진단하기' })).toBeDisabled()
  })

  // 분석은 30초~2분짜리라 기다리게 하지 않는다 — 접수만 하고 안내 Modal 을 띄운다.
  it('진단을 누르면 안내 Modal 이 뜬다', async () => {
    const user = userEvent.setup()
    renderAnalyze()
    await uploadAllSlots(user)

    await user.click(screen.getByRole('button', { name: 'OCR 진단하기' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('약 30초~2분')
    expect(startAnalysis).toHaveBeenCalledTimes(1)
  })

  it('Modal 의 AI 상담하기로 대화 화면에 간다', async () => {
    const user = userEvent.setup()
    renderAnalyze()
    await uploadAllSlots(user)

    await user.click(screen.getByRole('button', { name: 'OCR 진단하기' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'AI 상담하기' }))

    expect(await screen.findByText('상담 화면')).toBeInTheDocument()
  })

  // Modal 을 닫아도 진행 중임이 화면에 남아야 409 로 막히는 이유가 눈에 보인다.
  it('Modal 을 닫아도 진행 상태와 결과 보기 링크가 남는다', async () => {
    const user = userEvent.setup()
    renderAnalyze()
    await uploadAllSlots(user)

    await user.click(screen.getByRole('button', { name: 'OCR 진단하기' }))
    const dialog = await screen.findByRole('dialog')
    // Modal 우상단 X 도 이름이 "닫기" 다 — 본문 액션의 닫기 버튼은 뒤쪽이다.
    const closeButtons = within(dialog).getAllByRole('button', { name: '닫기' })
    await user.click(closeButtons[closeButtons.length - 1])

    expect(screen.getByRole('button', { name: '분석 진행 중...' })).toBeDisabled()
    expect(screen.getByRole('link', { name: '결과 보기' })).toHaveAttribute(
      'href',
      '/risk-report/job-1',
    )
  })

  it('접수에 실패하면 Modal 을 열지 않는다', async () => {
    startAnalysis.mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    renderAnalyze()
    await uploadAllSlots(user)

    await user.click(screen.getByRole('button', { name: 'OCR 진단하기' }))

    await waitFor(() => expect(startAnalysis).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // 다시 시도할 수 있도록 버튼이 되돌아온다.
    expect(screen.getByRole('button', { name: 'OCR 진단하기' })).toBeEnabled()
  })

  // 응답을 못 받았을 뿐 서버는 이미 접수했을 수 있다 — 같은 묶음이면 같은 키로 보낸다.
  it('같은 서류로 재시도하면 같은 Idempotency-Key 를 쓴다', async () => {
    startAnalysis.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    renderAnalyze()
    await uploadAllSlots(user)

    await user.click(screen.getByRole('button', { name: 'OCR 진단하기' }))
    await waitFor(() => expect(startAnalysis).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: 'OCR 진단하기' }))
    await waitFor(() => expect(startAnalysis).toHaveBeenCalledTimes(2))

    const [, firstKey] = startAnalysis.mock.calls[0] as [File[], string]
    const [, secondKey] = startAnalysis.mock.calls[1] as [File[], string]
    expect(firstKey).toBeTruthy()
    expect(secondKey).toBe(firstKey)
  })
})
