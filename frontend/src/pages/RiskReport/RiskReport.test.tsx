import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetNotificationStoreForTests } from '../../hooks/useNotifications'
import type { AnalysisJobDetail, AnalysisJobSummary, AnalysisStatus } from '../../types/analysis'
import { RiskReport } from './RiskReport'

const getAnalysis = vi.hoisted(() => vi.fn())
const listAnalyses = vi.hoisted(() => vi.fn())
const updateAnalysisTitle = vi.hoisted(() => vi.fn())
const deleteAnalysis = vi.hoisted(() => vi.fn())
const listNotifications = vi.hoisted(() => vi.fn())
const markNotificationsRead = vi.hoisted(() => vi.fn())

vi.mock('../../api/analyses', () => ({
  getAnalysis,
  listAnalyses,
  updateAnalysisTitle,
  deleteAnalysis,
  startAnalysis: vi.fn(),
  ANALYSIS_TITLE_MAX: 200,
}))
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

/** 목록 응답 한 줄 — 상세와 달리 result·error 가 없다. */
function summary(patch: Partial<AnalysisJobSummary> = {}): AnalysisJobSummary {
  return {
    id: 'job-1',
    status: 'SUCCEEDED',
    stage: null,
    progress: 100,
    file_names: ['계약서.pdf'],
    title: '주택 임대차계약서',
    risk_level: 'HIGH',
    created_at: '2026-07-30T05:30:00Z',
    finished_at: '2026-07-30T05:31:00Z',
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
      contract_type: '전세' as const,
      deposit: '3억 원',
      monthly_rent: '없음',
      contract_start: '2026-08-01',
      contract_end: '2028-07-31',
      address: '서울특별시 강남구 테헤란로 123',
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
    expect(screen.getByText('건물 유형: 아파트')).toBeInTheDocument()
    expect(screen.getByText('3억 원')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '수선 책임 전가' })).toBeInTheDocument()
    // 예전 하드코딩 샘플이 다시 새어나오지 않는지.
    expect(screen.queryByText(/선순위 권리 유지/)).not.toBeInTheDocument()
  })

  it('전세면 월세 칸을 그리지 않는다', async () => {
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('계약 유형')).toBeInTheDocument()
    expect(screen.getByText('전세')).toBeInTheDocument()
    expect(screen.queryByText('월세')).not.toBeInTheDocument()
  })

  it('월세면 보증금과 월세를 함께 그린다', async () => {
    getAnalysis.mockResolvedValue(
      job('SUCCEEDED', {
        result: {
          ...RESULT,
          analysis: {
            ...RESULT.analysis,
            terms: {
              ...RESULT.analysis.terms,
              contract_type: '월세' as const,
              monthly_rent: '70만원',
            },
          },
        },
      }),
    )
    renderReport('/risk-report/job-1')

    // "월세" 는 두 번 나온다 — 계약 유형 값과 월세 칸 라벨.
    expect(await screen.findAllByText('월세')).toHaveLength(2)
    expect(screen.getByText('70만원')).toBeInTheDocument()
    expect(screen.getByText('3억 원')).toBeInTheDocument()
  })

  it('contract_type 이 없는 예전 분석도 월세 원문으로 유형을 메운다', async () => {
    // 결과 전문이 JSONB 한 덩어리라 예전 레코드에는 이 키가 아예 없다.
    getAnalysis.mockResolvedValue(
      job('SUCCEEDED', {
        result: {
          ...RESULT,
          analysis: {
            ...RESULT.analysis,
            terms: { ...RESULT.analysis.terms, contract_type: null, monthly_rent: '금 오십만원정' },
          },
        },
      }),
    )
    renderReport('/risk-report/job-1')

    expect(await screen.findAllByText('월세')).toHaveLength(2)
    // 금액이 한글로만 적혀 있어도 전세로 뒤집히지 않아야 한다.
    expect(screen.getByText('금 오십만원정')).toBeInTheDocument()
  })

  it('건물 사진 카드에 주거형태를 적는다', async () => {
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('주거형태')).toBeInTheDocument()
    // "아파트" 는 두 번 나온다 — 헤더의 "건물 유형: 아파트" 와 이 카드의 값.
    expect(screen.getAllByText('아파트').length).toBeGreaterThan(0)
  })

  it('주거형태를 모르면 확인되지 않음으로 적는다', async () => {
    getAnalysis.mockResolvedValue(
      job('SUCCEEDED', {
        result: {
          ...RESULT,
          analysis: {
            ...RESULT.analysis,
            terms: { ...RESULT.analysis.terms, property_type: null },
          },
        },
      }),
    )
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('확인되지 않음')).toBeInTheDocument()
  })

  it('분석된 주소를 지도 카드에 함께 보여준다', async () => {
    // 테스트 환경에는 카카오 키가 없어서 지도는 대체 화면으로 뜬다 — SDK 목킹이 필요 없다.
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('서울특별시 강남구 테헤란로 123')).toBeInTheDocument()
  })

  it('주소가 없으면 안내 문구를 보여준다', async () => {
    getAnalysis.mockResolvedValue(
      job('SUCCEEDED', {
        result: {
          ...RESULT,
          analysis: {
            ...RESULT.analysis,
            terms: { ...RESULT.analysis.terms, address: null },
          },
        },
      }),
    )
    renderReport('/risk-report/job-1')

    expect(await screen.findByText('위치 정보를 찾을 수 없습니다')).toBeInTheDocument()
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

describe('RiskReport (jobId 없음) — 분석 목록', () => {
  it('이전 분석이 있으면 리다이렉트 없이 목록을 보여준다', async () => {
    listAnalyses.mockResolvedValue({
      items: [summary({ id: 'job-new' }), summary({ id: 'job-old', title: '오피스텔 계약서' })],
      next_cursor: null,
    })
    renderReport('/risk-report')

    expect(await screen.findByRole('heading', { name: '최근 진단 내역' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '주택 임대차계약서 리포트 보기' })).toHaveAttribute(
      'href',
      '/risk-report/job-new',
    )
    expect(screen.getByRole('link', { name: '오피스텔 계약서 리포트 보기' })).toBeInTheDocument()
    expect(screen.getAllByText('HIGH RISK (위험)')).toHaveLength(2)
    // 자동 리다이렉트가 사라진 것을 여기서 고정한다 — 최신 결과에 갇히지 않는다.
    expect(getAnalysis).not.toHaveBeenCalled()
  })

  it('분석 CTA 는 헤더에 하나만 둔다', async () => {
    listAnalyses.mockResolvedValue({ items: [summary()], next_cursor: null })
    renderReport('/risk-report')

    const cta = await screen.findAllByRole('link', { name: '새 계약서 분석하기' })
    expect(cta).toHaveLength(1)
    expect(cta[0]).toHaveAttribute('href', '/analyze')
  })

  it('진행 중인 분석은 목록에서 눌러 진행 화면으로 갈 수 있다', async () => {
    listAnalyses.mockResolvedValue({
      items: [
        summary({ id: 'job-run', status: 'RUNNING', risk_level: null, title: '분석 중 계약서' }),
      ],
      next_cursor: null,
    })
    renderReport('/risk-report')

    expect(await screen.findByText('분석 중')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '분석 중 계약서 리포트 보기' })).toHaveAttribute(
      'href',
      '/risk-report/job-run',
    )
  })

  // 열어도 보여줄 리포트가 없다 — 실패 화면으로 보내지 않는다.
  it('실패한 분석은 목록에 남지만 누를 수 없다', async () => {
    listAnalyses.mockResolvedValue({
      items: [
        summary({ id: 'job-fail', status: 'FAILED', risk_level: null, title: '실패한 계약서' }),
        summary({
          id: 'job-cancel',
          status: 'CANCELLED',
          risk_level: null,
          title: '취소된 계약서',
        }),
        // SUCCEEDED 인데 등급이 없는 조합도 배지가 "분석 실패" 라 같이 막는다.
        summary({ id: 'job-empty', risk_level: null, title: '결과 없는 계약서' }),
      ],
      next_cursor: null,
    })
    renderReport('/risk-report')

    expect(await screen.findByText('실패한 계약서')).toBeInTheDocument()
    expect(screen.getByText('취소된 계약서')).toBeInTheDocument()
    expect(screen.getByText('결과 없는 계약서')).toBeInTheDocument()
    expect(screen.getAllByText('분석 실패')).toHaveLength(3)
    expect(screen.queryAllByRole('link', { name: /리포트 보기/ })).toHaveLength(0)
  })

  it('목록에서 항목을 누르면 그 분석의 리포트를 연다', async () => {
    listAnalyses.mockResolvedValue({ items: [summary({ id: 'job-7' })], next_cursor: null })
    getAnalysis.mockResolvedValue(job('SUCCEEDED', { id: 'job-7', result: RESULT }))
    const user = userEvent.setup()
    renderReport('/risk-report')

    await user.click(await screen.findByRole('link', { name: '주택 임대차계약서 리포트 보기' }))

    await waitFor(() => expect(getAnalysis).toHaveBeenCalledWith('job-7', true))
    expect(await screen.findByRole('heading', { name: '종합 리스크 리포트' })).toBeInTheDocument()
  })

  it('다음 페이지가 있으면 더 보기로 이어붙인다', async () => {
    listAnalyses.mockResolvedValueOnce({
      items: [summary({ id: 'job-1' })],
      next_cursor: 'cursor-1',
    })
    const user = userEvent.setup()
    renderReport('/risk-report')

    const loadMore = await screen.findByRole('button', { name: '더 보기' })
    listAnalyses.mockResolvedValueOnce({
      items: [summary({ id: 'job-2', title: '두 번째 계약서' })],
      next_cursor: null,
    })
    await user.click(loadMore)

    expect(await screen.findByText('두 번째 계약서')).toBeInTheDocument()
    expect(listAnalyses).toHaveBeenLastCalledWith('cursor-1', 5)
    expect(screen.queryByRole('button', { name: '더 보기' })).not.toBeInTheDocument()
  })

  it('분석한 적이 없으면 빈 상태와 분석 CTA 를 보여준다', async () => {
    listAnalyses.mockResolvedValue({ items: [], next_cursor: null })
    renderReport('/risk-report')

    expect(await screen.findByText('아직 분석한 계약서가 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '계약서 분석하기' })).toHaveAttribute(
      'href',
      '/analyze',
    )
    expect(getAnalysis).not.toHaveBeenCalled()
  })

  // 서버 장애가 "분석한 적 없음" 으로 보이면 안 된다.
  it('목록 조회가 실패하면 빈 상태가 아니라 오류 화면을 보여준다', async () => {
    listAnalyses.mockRejectedValue(new Error('boom'))
    renderReport('/risk-report')

    expect(await screen.findByRole('alert')).toHaveTextContent('분석 기록을 불러오지 못했습니다.')
    expect(screen.queryByText('아직 분석한 계약서가 없습니다.')).not.toBeInTheDocument()
  })
})

describe('RiskReport 목록 — 제목 수정·삭제', () => {
  async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(await screen.findByRole('button', { name }))
  }

  it('제목을 수정하면 목록에 바로 반영된다', async () => {
    listAnalyses.mockResolvedValue({ items: [summary({ id: 'job-9' })], next_cursor: null })
    updateAnalysisTitle.mockResolvedValue(summary({ id: 'job-9', title: '강남 원룸' }))
    const user = userEvent.setup()
    renderReport('/risk-report')

    await openMenu(user, '주택 임대차계약서 옵션')
    await user.click(screen.getByRole('menuitem', { name: '제목 수정' }))

    const input = screen.getByLabelText('분석 제목')
    await user.clear(input)
    await user.type(input, '강남 원룸')
    await user.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(updateAnalysisTitle).toHaveBeenCalledWith('job-9', '강남 원룸'))
    expect(await screen.findByText('강남 원룸')).toBeInTheDocument()
    // 목록을 다시 부르지 않는다 — "더 보기" 로 쌓은 페이지가 되감기면 안 된다.
    expect(listAnalyses).toHaveBeenCalledTimes(1)
  })

  it('삭제를 확인하면 그 행이 목록에서 사라진다', async () => {
    listAnalyses.mockResolvedValue({
      items: [summary({ id: 'job-9' }), summary({ id: 'job-8', title: '남는 계약서' })],
      next_cursor: null,
    })
    deleteAnalysis.mockResolvedValue(summary({ id: 'job-9' }))
    const user = userEvent.setup()
    renderReport('/risk-report')

    await openMenu(user, '주택 임대차계약서 옵션')
    await user.click(screen.getByRole('menuitem', { name: '삭제' }))
    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(deleteAnalysis).toHaveBeenCalledWith('job-9'))
    await waitFor(() => expect(screen.queryByText('주택 임대차계약서')).not.toBeInTheDocument())
    expect(screen.getByText('남는 계약서')).toBeInTheDocument()
  })

  // 제목은 산출물에 있다 — 결과가 없는 실패 기록은 고칠 자리가 없다.
  it('실패한 분석 메뉴에는 삭제만 있다', async () => {
    listAnalyses.mockResolvedValue({
      items: [summary({ id: 'job-f', status: 'FAILED', risk_level: null, title: '실패 계약서' })],
      next_cursor: null,
    })
    const user = userEvent.setup()
    renderReport('/risk-report')

    await openMenu(user, '실패 계약서 옵션')

    expect(screen.getByRole('menuitem', { name: '삭제' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '제목 수정' })).not.toBeInTheDocument()
  })

  it('삭제가 실패하면 행을 지우지 않는다', async () => {
    listAnalyses.mockResolvedValue({ items: [summary({ id: 'job-9' })], next_cursor: null })
    // 진행 중인 분석은 서버가 409 로 막는다 — 원인은 공통 오류 모달이 말한다.
    deleteAnalysis.mockRejectedValue(new Error('409'))
    const user = userEvent.setup()
    renderReport('/risk-report')

    await openMenu(user, '주택 임대차계약서 옵션')
    await user.click(screen.getByRole('menuitem', { name: '삭제' }))
    await user.click(screen.getByRole('button', { name: '삭제' }))

    await waitFor(() => expect(deleteAnalysis).toHaveBeenCalled())
    expect(screen.getByText('주택 임대차계약서')).toBeInTheDocument()
  })
})
