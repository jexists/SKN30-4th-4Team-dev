/**
 * `3분 전` 같은 상대 시각. 드롭다운과 알림 페이지가 같은 문구를 쓰도록 여기 한 곳에 둔다.
 *
 * `Intl.RelativeTimeFormat` 을 쓰지 않는 이유: "1일 전"과 "어제"를 섞어 쓰거나 로케일에 따라
 * 문구가 달라지는 것보다, 알림 목록에서는 짧고 예측 가능한 한국어 한 형태가 낫다.
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const diff = now - then
  // 서버·클라이언트 시계가 조금 어긋나 미래로 보이는 경우까지 "0초 뒤"로 쓰지 않는다.
  if (diff < MINUTE) return '방금 전'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}분 전`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}시간 전`
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}일 전`

  const date = new Date(then)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}
