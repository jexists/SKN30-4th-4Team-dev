import type { ChatRoom } from '../../api/chatHistory'

export interface RoomGroup {
  label: string
  rooms: ChatRoom[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 로컬 달력의 날짜를 UTC 숫자로 바꿔 DST 와 무관하게 자정 경계를 센다. */
function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
}

function groupLabel(iso: string, now: Date): string {
  const date = new Date(iso)
  const diffDays = calendarDay(now) - calendarDay(date)

  // 메시지 직후 로컬 시각이 서버 시각보다 조금 앞서도 오늘 그룹에 그대로 둔다.
  if (diffDays <= 0) return '오늘'
  if (diffDays === 1) return '어제'
  if (diffDays <= 7) return '지난 7일'
  if (diffDays <= 30) return '지난 30일'
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`
}

/** last_chat_at 기준 오늘/어제/지난 7일/지난 30일/YYYY년 M월 로 묶는다. */
export function groupRoomsByDate(rooms: ChatRoom[], now = new Date()): RoomGroup[] {
  const groups: RoomGroup[] = []

  for (const room of rooms) {
    const label = groupLabel(room.last_chat_at, now)
    const current = groups[groups.length - 1]
    if (current?.label === label) {
      current.rooms.push(room)
    } else {
      groups.push({ label, rooms: [room] })
    }
  }

  return groups
}
