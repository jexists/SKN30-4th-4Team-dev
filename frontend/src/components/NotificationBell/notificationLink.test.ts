import { describe, expect, it } from 'vitest'

import type { AppNotification, NotificationType } from '../../types/notification'
import { notificationLink } from './notificationLink'
import { relativeTime } from './relativeTime'

function make(patch: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 'n1',
    type: 'ANALYSIS_COMPLETED',
    title: 'AI 분석이 완료되었습니다.',
    content: '분석 결과를 확인해보세요.',
    resource_type: 'ANALYSIS_JOB',
    resource_id: 'job-1',
    read_at: null,
    created_at: '2026-07-30T00:00:00Z',
    ...patch,
  }
}

describe('notificationLink', () => {
  it('분석 작업 알림은 결과 페이지로 보낸다', () => {
    expect(notificationLink(make())).toBe('/risk-report/job-1')
  })

  // 갈 곳이 없으면 화면이 행을 버튼이 아니라 div 로 그린다 — 눌러도 반응 없는 행을 만들지 않기 위함.
  it.each<NotificationType>(['WELCOME', 'GENERAL'])('%s 은 갈 곳이 없다', (type) => {
    expect(notificationLink(make({ type, resource_type: null, resource_id: null }))).toBeNull()
  })

  it('resource_type 이 있어도 id 가 없으면 경로를 만들지 않는다', () => {
    expect(notificationLink(make({ resource_id: null }))).toBeNull()
  })
})

describe('relativeTime', () => {
  const now = new Date('2026-07-30T12:00:00Z').getTime()
  const at = (iso: string) => relativeTime(iso, now)

  it('1분 미만은 방금 전', () => {
    expect(at('2026-07-30T11:59:30Z')).toBe('방금 전')
  })

  it('분·시간·일 단위로 내려간다', () => {
    expect(at('2026-07-30T11:57:00Z')).toBe('3분 전')
    expect(at('2026-07-30T09:00:00Z')).toBe('3시간 전')
    expect(at('2026-07-28T12:00:00Z')).toBe('2일 전')
  })

  it('일주일이 넘으면 날짜로 보여준다', () => {
    expect(at('2026-07-01T12:00:00Z')).toMatch(/^2026\.07\.0\d$/)
  })

  // 서버·클라이언트 시계가 어긋나 미래로 보이는 값에도 이상한 문구를 내지 않는다.
  it('미래 시각도 방금 전으로 다룬다', () => {
    expect(at('2026-07-30T12:05:00Z')).toBe('방금 전')
  })

  it('해석할 수 없는 값은 빈 문자열', () => {
    expect(at('not-a-date')).toBe('')
  })
})
