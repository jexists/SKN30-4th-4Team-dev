import { describe, expect, it } from 'vitest'

import type { ChatRoom } from '../../api/chatHistory'
import { groupRoomsByDate } from './roomGroups'

const NOW = new Date(2026, 6, 25, 12)

function room(id: string, date: Date): ChatRoom {
  return {
    id,
    title: id,
    last_chat_at: date.toISOString(),
    updated_at: date.toISOString(),
    // 날짜 그룹핑과 무관한 필드지만 ChatRoom 계약을 만족시켜야 한다.
    analysis_job_id: null,
    analysis_file_name: null,
  }
}

describe('groupRoomsByDate', () => {
  it('로컬 자정 기준으로 오늘과 어제를 나눈다', () => {
    const today = new Date(2026, 6, 25, 0, 0, 1)
    const yesterday = new Date(2026, 6, 24, 23, 59, 59)

    const groups = groupRoomsByDate([room('오늘', today), room('어제', yesterday)], NOW)

    expect(groups.map((group) => group.label)).toEqual(['오늘', '어제'])
  })

  it('7일과 30일 경계는 각 기간 그룹에 포함한다', () => {
    const sevenDaysAgo = new Date(2026, 6, 18, 0)
    const eightDaysAgo = new Date(2026, 6, 17, 23, 59)
    const thirtyDaysAgo = new Date(2026, 5, 25, 0)
    const thirtyOneDaysAgo = new Date(2026, 5, 24, 23, 59)

    const groups = groupRoomsByDate(
      [
        room('7일', sevenDaysAgo),
        room('8일', eightDaysAgo),
        room('30일', thirtyDaysAgo),
        room('31일', thirtyOneDaysAgo),
      ],
      NOW,
    )

    expect(groups.map((group) => group.label)).toEqual(['지난 7일', '지난 30일', '2026년 6월'])
    expect(groups[1].rooms.map((item) => item.id)).toEqual(['8일', '30일'])
  })

  it('서버 시각이 조금 미래여도 오늘로 묶는다', () => {
    const future = new Date(2026, 6, 26, 1)

    expect(groupRoomsByDate([room('미래', future)], NOW)[0].label).toBe('오늘')
  })

  it('빈 목록은 빈 그룹을 반환한다', () => {
    expect(groupRoomsByDate([], NOW)).toEqual([])
  })
})
