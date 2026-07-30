import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetNotificationStoreForTests } from '../../hooks/useNotifications'
import type { AnalysisJobDetail, AnalysisStatus } from '../../types/analysis'
import { RiskReport } from './RiskReport'

const getAnalysis = vi.hoisted(() => vi.fn())
const listAnalyses = vi.hoisted(() => vi.fn())
const listNotifications = vi.hoisted(() => vi.fn())
const markNotificationsRead = vi.hoisted(() => vi.fn())

vi.mock('../../api/analyses', () => ({ getAnalysis, listAnalyses, startAnalysis: vi.fn() }))
vi.mock('../../api/notifications', () => ({
  listNotifications,
  markNotificationsRead,
  deleteNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
}))

function job(status: AnalysisStatus, patch: Partial<AnalysisJobDetail> = {}): AnalysisJobDetail {
  return {
    id: 'job-1',
    status,
    stage: null,
    progress: 0,
    file_names: ['계약서.pdf'],
    title: '주택 임대차계약서',
    risk_level: null,
    created_at: '2026-07-30T00:00:00Z',
    finished_at: null,
    summary: null,
    attempt_count: 1,
    result: null,
    error: null,
    ...patch,
  }
}

const RESULT = {
  sanitized_text: '',
  redaction_counts: {},
  redaction_scope: [],
  mask_count: 4,
  coarse_mask_count: 0,
  review_required: false,
  documents: [],
  analysis: {
    summary: '보증금 대비 선순위 채권이 많아 주의가 필요합니다.',
    terms: {
      deposit: '3억 원',
      monthly_rent: '없음',
      contract_start: '2026-08-01',
      contract_end: '2028-07-31',
      property_type: '아파트',
      special_terms: [],
    },
    risks: [
      {
        severity: 'HIGH' as const,
        title: '수선 책임 전가',
        clause: '임차인이 모든 수리 책임을 진다.',
        reason: '구조적 하자까지 임차인에게 넘긴다.',
        recommendation: '특약을 다시 협의하세요.',
      },
    ],
    missing_information: [],
  },
}

function renderReport(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/risk-report" element={<RiskReport />} />
        <Route path="/risk-report/:jobId" element={<RiskReport />} />
        <Route path="/analyze" element={<h1>분석 화면</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listNotifications.mockResolvedValue({ items: [], next_cursor: null })
  markNotificationsRead.mockResolvedValue({ affected: 0, unread_count: 0 })
})

afterEach(() => {
  __resetNotificationStoreForTests()
  vi.clearAllMocks()
})

describe('RiskReport 진행 상태', () => {
  it('QUEUED 면 진행 화면과 예상 시간을 보여준다', async () => {
    getAnalysis.mockResolvedValue(job('QUEUED'))
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('분석을 준비하고 있습니다')).toBeInTheDocument()
    expect(screen.getByText(/약 30초~2분/)).toBeInTheDocument()
  })

  it('RUNNING 이면 서버가 알려준 단계를 문구로 보여준다', async () => {
    getAnalysis.mockResolvedValue(job('RUNNING', { stage: 'OCR', progress: 40 }))
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('문서에서 글자를 읽고 있습니다')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40')
  })

  it('끝나지 않았으면 폴링을 계속한다', async () => {
    vi.useFakeTimers()
    try {
      getAnalysis.mockResolvedValue(job('RUNNING', { stage: 'LLM' }))
      renderReport('/risk-report/job-1')

      await vi.waitFor(() => expect(getAnalysis).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(5_000)
      expect(getAnalysis).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('종료 상태면 폴링을 멈춘다', async () => {
    vi.useFakeTimers()
    try {
      getAnalysis.mockResolvedValue(job('SUCCEEDED', { result: RESULT }))
      renderReport('/risk-report/job-1')

      await vi.waitFor(() => expect(getAnalysis).toHaveBeenCalledTimes(1))
      await vi.advanceTimersByTimeAsync(20_000)
      expect(getAnalysis).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('RiskReport 실패', () => {
  it('서버가 준 실패 문구를 그대로 보여주고 빠져나갈 길을 준다', async () => {
    getAnalysis.mockResolvedValue(
      job('FAILED', { error: { code: 'OCR_FAILED', message: '문서를 인식하지 못했습니다.' } }),
    )
    const user = userEvent.setup()
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('문서를 인식하지 못했습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '다시 분석하기' }))
    expect(await screen.findByText('분석 화면')).toBeInTheDocument()
  })

  it('조회 자체가 실패하면 오류 화면을 보여준다', async () => {
    getAnalysis.mockRejectedValue(new Error('boom'))
    renderReport('/risk-report/job-1')

    expect(await screen.findByRole('alert')).toHaveTextContent('분석 결과를 불러오지 못했습니다.')
  })
})

describe('RiskReport 완료', () => {
  beforeEach(() => {
    getAnalysis.mockResolvedValue(job('SUCCEEDED', { risk_level: 'HIGH', result: RESULT }))
  })

  it('서버 결과로 리포트를 그린다 (mock 폴백 없음)', async () => {
    renderReport('/risk-report/job-1')

    expect(await screen.findByRole('heading', { name: '종합 리스크 리포트' })).toBeInTheDocument()
    expect(screen.getByText('계약 유형: 아파트')).toBeInTheDocument()
    expect(screen.getByText('3억 원')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '수선 책임 전가' })).toBeInTheDocument()
    // 예전 하드코딩 샘플이 다시 새어나오지 않는지.
    expect(screen.queryByText(/선순위 권리 유지/)).not.toBeInTheDocument()
  })

  it('결과를 열면 그 작업의 알림을 읽음 처리한다', async () => {
    listNotifications.mockResolvedValue({
      items: [
        {
          id: 'n1',
          type: 'ANALYSIS_COMPLETED',
          title: '완료',
          content: '',
          resource_type: 'ANALYSIS_JOB',
          resource_id: 'job-1',
          read_at: null,
          created_at: '2026-07-30T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
    renderReport('/risk-report/job-1')

    await screen.findByRole('heading', { name: '종합 리스크 리포트' })
    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(['n1']))
  })

  // 마스킹 PDF 를 서버에 보관하지 않으므로 브라우저 인쇄로 대신한다.
  it('PDF 다운로드는 브라우저 인쇄를 부른다', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    try {
      const user = userEvent.setup()
      renderReport('/risk-report/job-1')

      await user.click(await screen.findByRole('button', { name: /PDF 다운로드/ }))
      expect(print).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('RiskReport (jobId 없음)', () => {
  it('가장 최근 성공 분석으로 보낸다', async () => {
    listAnalyses.mockResolvedValue({
      items: [
        { id: 'job-old', status: 'FAILED' },
        { id: 'job-new', status: 'SUCCEEDED' },
      ],
      next_cursor: null,
    })
    getAnalysis.mockResolvedValue(job('SUCCEEDED', { id: 'job-new', result: RESULT }))

    renderReport('/risk-report')

    await waitFor(() => expect(getAnalysis).toHaveBeenCalledWith('job-new', true))
    expect(await screen.findByRole('heading', { name: '종합 리스크 리포트' })).toBeInTheDocument()
  })

  it('완료된 분석이 없으면 빈 상태와 분석 CTA 를 보여준다', async () => {
    listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
    renderReport('/risk-report')

    expect(await screen.findByText('아직 분석한 계약서가 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '계약서 분석하기' })).toHaveAttribute(
      'href',
      '/analyze',
    )
    expect(getAnalysis).not.toHaveBeenCalled()
  })
})
