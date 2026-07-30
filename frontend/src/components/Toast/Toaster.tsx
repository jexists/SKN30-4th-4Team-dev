import type { ComponentType } from 'react'
import { createPortal } from 'react-dom'

import { Check, Close, Info, Warn } from '../icons'
import styles from './Toaster.module.scss'
import { dismissToast, useToasts, type ToastType } from './toastStore'

const ICONS: Record<ToastType, ComponentType<{ className?: string }>> = {
  error: Warn,
  success: Check,
  info: Info,
}

/**
 * 화면 상단에 토스트 목록을 그려주는 렌더러. App 에 한 번만 두면 되고,
 * 알림은 어디서든 `showToast(...)` 로 띄운다. 포털로 body 에 렌더한다.
 */
export function Toaster() {
  const toasts = useToasts()
  if (toasts.length === 0) return null

  return createPortal(
    <div className={styles.viewport} data-print="hide">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type]
        return (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.type]}`}
            role={toast.type === 'error' ? 'alert' : 'status'}
          >
            <Icon className={styles.icon} />
            <span className={styles.message}>{toast.message}</span>
            <button
              type="button"
              className={styles.close}
              onClick={() => dismissToast(toast.id)}
              aria-label="닫기"
            >
              <Close className={styles.closeMark} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
