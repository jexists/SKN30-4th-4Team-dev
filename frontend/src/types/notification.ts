export type NotificationType =
  | 'GENERAL'
  | 'WELCOME'
  | 'ANALYSIS_STARTED'
  | 'ANALYSIS_COMPLETED'
  | 'ANALYSIS_FAILED'

export type NotificationResourceType = 'ANALYSIS_JOB'

/**
 * 알림 한 건. 이름 앞에 App 을 붙인 이유는 브라우저 전역 `Notification`(데스크톱 알림 API)과
 * 이름이 겹치기 때문이다 — 같은 파일에서 둘 다 쓰는 곳이 있다.
 */
export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  content: string
  /** 클릭 시 이동할 대상. 경로는 프론트가 만든다(notificationLink.ts). */
  resource_type: NotificationResourceType | null
  resource_id: string | null
  /** null 이면 안읽음. 서버가 불리언을 따로 주지 않는 이유는 isRead 참고. */
  read_at: string | null
  created_at: string
}

/**
 * 읽음 여부. 서버는 `read_at` 하나만 내려준다 — 같은 사실을 불리언으로도 함께 보내면
 * 소비자가 어느 쪽을 믿을지 헷갈리기 때문이다. 파생은 여기 한 곳에서만 한다.
 */
export function isRead(notification: AppNotification): boolean {
  return notification.read_at !== null
}

export interface UnreadCount {
  count: number
}

/** 읽음/삭제 처리 결과. 낙관적 갱신을 서버 실제값으로 맞추는 데 쓴다. */
export interface NotificationMutation {
  affected: number
  unread_count: number
}
