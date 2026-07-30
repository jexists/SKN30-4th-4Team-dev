import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetNotificationStoreForTests,
  syncUnreadCount,
} from '../../hooks/useNotifications'
import type { AppNotification } from '../../types/notification'
import { NotificationBell } from './NotificationBell'

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

function make(patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    type: 'ANALYSIS_COMPLETED',
    title: 'AI 분석이 완료되었습니다.',
    content: '분석 결과를 확인해보세요.',
    resource_type: 'ANALYSIS_JOB',
    resource_id: 'job-1',
    read_at: null,
    created_at: new Date().toISOString(),
    ...patch,
  }
}

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<NotificationBell />} />
        <Route path="/risk-report/:jobId" element={<h1>결과 화면</h1>} />
        <Route path="/notifications" element={<h1>알림 화면</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listNotifications.mockResolvedValue({ items: [make()], next_cursor: null })
  markNotificationsRead.mockResolvedValue({ affected: 1, unread_count: 0 })
  getUnreadCount.mockResolvedValue({ count: 0 })
})

afterEach(() => {
  __resetNotificationStoreForTests()
  vi.clearAllMocks()
})

describe('NotificationBell 배지', () => {
  it('안읽음이 없으면 배지를 그리지 않는다', () => {
    renderBell()

    expect(screen.getByLabelText('알림')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('안읽음 개수를 배지와 접근성 라벨에 함께 담는다', () => {
    syncUnreadCount(3)
    renderBell()

    expect(screen.getByLabelText('알림 3개 읽지 않음')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  // 세 자리가 되면 배지가 아이콘을 밀어낸다.
  it('99 를 넘으면 99+ 로 줄인다', () => {
    syncUnreadCount(1200)
    renderBell()

    expect(screen.getByText('99+')).toBeInTheDocument()
    expect(screen.getByLabelText('알림 1200개 읽지 않음')).toBeInTheDocument()
  })
})

describe('NotificationBell 드롭다운', () => {
  it('열기 전에는 목록을 부르지 않는다', () => {
    renderBell()

    expect(listNotifications).not.toHaveBeenCalled()
  })

  it('종을 누르면 최근 알림을 보여주고 전체 보기 링크를 준다', async () => {
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByLabelText('알림'))

    expect(await screen.findByText('AI 분석이 완료되었습니다.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '전체 보기' })).toHaveAttribute(
      'href',
      '/notifications',
    )
  })

  it('행을 누르면 읽음 처리하고 결과 화면으로 이동한다', async () => {
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByLabelText('알림'))
    await user.click(await screen.findByRole('menuitem', { name: /AI 분석이 완료되었습니다/ }))

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(['n1']))
    expect(await screen.findByText('결과 화면')).toBeInTheDocument()
  })

  // 눌러도 아무 일이 없는 행은 고장처럼 보인다 — 애초에 누를 수 있어 보이지 않게 한다.
  it('갈 곳이 없는 알림은 클릭 가능한 요소로 그리지 않는다', async () => {
    listNotifications.mockResolvedValue({
      items: [
        make({
          id: 'n2',
          type: 'WELCOME',
          title: '회원가입을 축하합니다.',
          resource_type: null,
          resource_id: null,
        }),
      ],
      next_cursor: null,
    })
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByLabelText('알림'))

    const panel = await screen.findByRole('menu', { name: '알림' })
    expect(within(panel).getByText('회원가입을 축하합니다.')).toBeInTheDocument()
    expect(within(panel).queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('ESC 로 닫힌다', async () => {
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByLabelText('알림'))
    expect(await screen.findByRole('menu', { name: '알림' })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: '알림' })).not.toBeInTheDocument()
  })

  it('모두 읽음은 ids 없이 전체를 처리한다', async () => {
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByLabelText('알림'))
    await user.click(await screen.findByRole('button', { name: '모두 읽음' }))

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledWith(undefined))
  })

  it('전부 읽은 상태면 모두 읽음 버튼을 감춘다', async () => {
    listNotifications.mockResolvedValue({
      items: [make({ read_at: '2026-07-30T00:00:00Z' })],
      next_cursor: null,
    })
    const user = userEvent.setup()
    renderBell()

    await user.click(screen.getByLabelText('알림'))

    await screen.findByRole('menu', { name: '알림' })
    expect(screen.queryByRole('button', { name: '모두 읽음' })).not.toBeInTheDocument()
  })
})

describe('NotificationBell 모바일', () => {
  it('좁은 화면에서는 드롭다운 대신 전용 페이지로 이동한다', async () => {
    // setup.ts 의 데스크탑 기본값(matches: false)을 이 테스트에서만 뒤집는다.
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia

    try {
      const user = userEvent.setup()
      renderBell()

      await user.click(screen.getByLabelText('알림'))

      expect(await screen.findByText('알림 화면')).toBeInTheDocument()
      expect(listNotifications).not.toHaveBeenCalled()
    } finally {
      window.matchMedia = original
    }
  })
})
