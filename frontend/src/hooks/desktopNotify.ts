/**
 * 브라우저 데스크톱 알림(OS 배너).
 *
 * 서비스워커·웹푸시 없이 **탭이 살아 있는 동안만** 동작한다 — 분석을 기다리며 다른 탭을 보고
 * 있는 사용자에게 완료를 알리는 게 목적이라 그걸로 충분하다.
 *
 * 여기서 실패하는 모든 경우(미지원 브라우저·권한 거부·비 HTTPS 컨텍스트)는 **조용히 무시**한다.
 * 데스크톱 배너는 덤이고, 사이트 안 종 아이콘이 원래 경로이기 때문이다.
 */

function isSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** 권한을 요청한다. 허용됐으면 true. 사용자가 알림 설정을 켤 때만 부른다. */
export async function requestDesktopPermission(): Promise<boolean> {
  if (!isSupported()) return false
  try {
    if (Notification.permission === 'granted') return true
    if (Notification.permission === 'denied') return false
    return (await Notification.requestPermission()) === 'granted'
  } catch {
    // 일부 브라우저는 사용자 제스처 밖에서 부르면 던진다 — 배너를 포기하고 넘어간다.
    return false
  }
}

export function canShowDesktopNotification(): boolean {
  return isSupported() && Notification.permission === 'granted'
}

export interface DesktopNotificationOptions {
  title: string
  body: string
  /** 같은 tag 의 배너는 서로를 대체한다 — 같은 작업 알림이 여러 개 쌓이지 않게. */
  tag?: string
  /** 배너를 클릭했을 때. 탭을 앞으로 가져오는 건 여기서 대신 해준다. */
  onClick?: () => void
}

/** 배너를 띄운다. 못 띄우면 조용히 false. */
export function showDesktopNotification({
  title,
  body,
  tag,
  onClick,
}: DesktopNotificationOptions): boolean {
  if (!canShowDesktopNotification()) return false
  try {
    const banner = new Notification(title, { body, tag })
    banner.onclick = () => {
      window.focus()
      banner.close()
      onClick?.()
    }
    return true
  } catch {
    return false
  }
}
