import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetNotificationStoreForTests } from '../../hooks/useNotifications'
import type { AppNotification } from '../../types/notification'
import { Notifications } from './Notifications'

const listNotifications = vi.hoisted(() => vi.fn())
const markNotificationsRead = vi.hoisted(() => vi.fn())
const deleteNotifications = vi.hoisted(() => vi.fn())
const getUnreadCount = vi.hoisted(() => vi.fn())

vi.mock('../../api/notifications', () => ({
  listNotifications,
  markNotificationsRead,
  deleteNotifications,
  getUnreadCount,
}))
vi.mock('../../api/analyses', () => ({ listAnalyses: vi.fn() }))

/** IntersectionObserver 는 jsdom 에 없다. 관찰이 시작되면 즉시 "보인다"고 알려 무한 스크롤을 흉내낸다. */
class ImmediateObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = ''
  readonly thresholds: readonly number[] = []
  constructor(private cb: IntersectionObserverCallback) {}
  observe() {
    this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this)
  }
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

function make(id: string, patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id,
    type: 'ANALYSIS_COMPLETED',
    title: `알림 ${id}`,
    content: '분석 결과를 확인해보세요.',
    resource_type: 'ANALYSIS_JOB',
    resource_id: `job-${id}`,
    read_at: null,
    created_at: new Date().toISOString(),
    ...patch,
  }
}

function renderPage(initialPath = '/notifications') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/risk-report/:jobId" element={<h1>결과 화면</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', ImmediateObserver)
  listNotifications.mockResolvedValue({ items: [make('1'), make('2')], next_cursor: null })
  markNotificationsRead.mockResolvedValue({ affected: 1, unread_count: 0 })
  deleteNotifications.mockResolvedValue({ affected: 1, unread_count: 0 })
  getUnreadCount.mockResolvedValue({ count: 0 })
})

afterEach(() => {
  __resetNotificationStoreForTests()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Notifications 탭', () => {
  it('기본은 전체 탭이고 서버에 unread 필터를 걸지 않는다', async () => {
    renderPage()

    await screen.findByText('알림 1')
    expect(listNotifications).toHaveBeenCalledWith({ unread: false, limit: 30 })
    expect(screen.getByRole('tab', { name: '전체' })).toHaveAttribute('aria-selected', 'true')
  })

  // 커서 페이지네이션과 클라이언트 필터를 섞으면 "30개 받았는데 안읽음이 2개뿐"인 빈 페이지가 생긴다.
  it('읽지 않음 탭은 서버에서 다시 조회한다', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('알림 1')

    await user.click(screen.getByRole('tab', { name: /읽지 않음/ }))

    await waitFor(() =>
      expect(listNotifications).toHaveBeenLastCalledWith({ unread: true, limit: 30 }),
    )
  })

  it('URL 쿼리로 들어오면 읽지 않음 탭으로 시작한다', async () => {
    renderPage('/notifications?tab=unread')

    await waitFor(() =>
      expect(listNotifications).toHaveBeenCalledWith({ unread: true, limit: 30 }),
    )
    expect(screen.getByRole('tab', { name: /읽지 않음/ })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('Notifications 목록', () => {
  it('링크가 있는 행을 누르면 읽음 처리 후 이동한다', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /알림 1/ }))

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(['1']))
    expect(await screen.findByText('결과 화면')).toBeInTheDocument()
  })

  it('갈 곳이 없는 알림은 버튼으로 그리지 않는다', async () => {
    listNotifications.mockResolvedValue({
      items: [make('1', { type: 'WELCOME', resource_type: null, resource_id: null })],
      next_cursor: null,
    })
    renderPage()

    await screen.findByText('알림 1')
    expect(screen.queryByRole('button', { name: /알림 1/ })).not.toBeInTheDocument()
  })

  it('0건이면 빈 상태 문구를 보여준다', async () => {
    listNotifications.mockResolvedValue({ items: [], next_cursor: null })
    renderPage()

    expect(await screen.findByText('아직 받은 알림이 없습니다.')).toBeInTheDocument()
  })

  it('읽지 않음 탭의 빈 상태는 문구가 다르다', async () => {
    listNotifications.mockResolvedValue({ items: [], next_cursor: null })
    renderPage('/notifications?tab=unread')

    expect(await screen.findByText('읽지 않은 알림이 없습니다.')).toBeInTheDocument()
  })

  // API 실패를 "알림 없음"으로 그리면 서버 장애가 정상처럼 보인다.
  it('조회에 실패하면 빈 상태가 아니라 오류를 보여준다', async () => {
    listNotifications.mockRejectedValue(new Error('boom'))
    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('알림을 불러오지 못했습니다.')
    expect(screen.queryByText('아직 받은 알림이 없습니다.')).not.toBeInTheDocument()
  })
})

describe('Notifications 무한 스크롤', () => {
  it('next_cursor 가 있으면 다음 페이지를 이어 붙인다', async () => {
    listNotifications
      .mockResolvedValueOnce({ items: [make('1')], next_cursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: [make('2')], next_cursor: null })

    renderPage()

    expect(await screen.findByText('알림 2')).toBeInTheDocument()
    expect(listNotifications).toHaveBeenLastCalledWith({
      unread: false,
      limit: 30,
      cursor: 'cursor-1',
    })
  })

  it('next_cursor 가 null 이면 더 부르지 않고 끝 문구를 보여준다', async () => {
    renderPage()

    expect(await screen.findByText('모든 알림을 확인했습니다.')).toBeInTheDocument()
    expect(listNotifications).toHaveBeenCalledTimes(1)
  })
})

describe('Notifications 선택 모드', () => {
  async function enterSelectMode() {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('알림 1')
    await user.click(screen.getByRole('button', { name: '선택' }))
    return user
  }

  it('선택 모드에 들어가면 체크박스와 액션바가 나타난다', async () => {
    await enterSelectMode()

    expect(screen.getByLabelText('알림 1 선택')).toBeInTheDocument()
    expect(screen.getByRole('toolbar', { name: '선택한 알림 작업' })).toBeInTheDocument()
    expect(screen.getByText('0개 선택')).toBeInTheDocument()
  })

  it('선택 모드에서는 행을 눌러도 이동하지 않는다', async () => {
    await enterSelectMode()

    expect(screen.queryByRole('button', { name: /알림 1/ })).not.toBeInTheDocument()
  })

  it('선택한 알림만 읽음 처리한다', async () => {
    const user = await enterSelectMode()

    await user.click(screen.getByLabelText('알림 1 선택'))
    expect(screen.getByText('1개 선택')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '읽음' }))

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(['1']))
    // 처리 후에는 선택 모드에서 빠져나온다.
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('불러온 항목 전체 선택을 토글한다', async () => {
    const user = await enterSelectMode()

    await user.click(screen.getByLabelText('불러온 알림 전체 선택'))
    expect(screen.getByText('2개 선택')).toBeInTheDocument()

    await user.click(screen.getByLabelText('불러온 알림 전체 선택'))
    expect(screen.getByText('0개 선택')).toBeInTheDocument()
  })

  it('선택 삭제는 확인 모달을 거친다', async () => {
    const user = await enterSelectMode()

    await user.click(screen.getByLabelText('알림 1 선택'))
    await user.click(screen.getByRole('button', { name: '삭제' }))

    const dialog = await screen.findByRole('dialog', { name: '알림 삭제' })
    expect(dialog).toHaveTextContent('선택한 알림 1개를 삭제하시겠습니까?')
    expect(deleteNotifications).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(deleteNotifications).toHaveBeenCalledWith(['1']))
  })
})

describe('Notifications 전체 삭제', () => {
  it('선택과 무관하게 전량 삭제하고 그 범위를 문구로 밝힌다', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('알림 1')

    await user.click(screen.getByRole('button', { name: '전체 삭제' }))

    const dialog = await screen.findByRole('dialog', { name: '알림 삭제' })
    expect(dialog).toHaveTextContent('모든 알림을 삭제하시겠습니까?')
    expect(dialog).toHaveTextContent('읽지 않음 탭에 보이지 않는 알림까지 모두 삭제되며')

    await user.click(within(dialog).getByRole('button', { name: '삭제' }))

    // ids 없이 부르면 서버가 전량 처리한다.
    await waitFor(() => expect(deleteNotifications).toHaveBeenCalledWith(undefined))
    expect(await screen.findByText('아직 받은 알림이 없습니다.')).toBeInTheDocument()
  })

  it('취소하면 아무것도 지우지 않는다', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('알림 1')

    await user.click(screen.getByRole('button', { name: '전체 삭제' }))
    const dialog = await screen.findByRole('dialog', { name: '알림 삭제' })
    await user.click(within(dialog).getByRole('button', { name: '취소' }))

    expect(deleteNotifications).not.toHaveBeenCalled()
    expect(screen.getByText('알림 1')).toBeInTheDocument()
  })
})
