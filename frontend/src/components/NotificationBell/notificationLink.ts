import type { AppNotification } from '../../types/notification'

/**
 * 알림을 클릭했을 때 갈 곳. 갈 곳이 없으면 null.
 *
 * **라우팅 지식은 여기에만 둔다.** 서버는 완성된 URL 대신 resource_type + resource_id 만
 * 저장한다 — 경로가 바뀌면 DB 에 남은 과거 알림이 통째로 깨지기 때문이다. 알림 종류가
 * 늘어도 이 함수 한 곳만 고치면 된다.
 */
export function notificationLink(notification: AppNotification): string | null {
  if (notification.resource_type === 'ANALYSIS_JOB' && notification.resource_id) {
    return `/risk-report/${notification.resource_id}`
  }
  return null
}
