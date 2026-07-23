import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import { Close } from '../icons'
import styles from './Modal.module.scss'

type ModalProps = {
  /** 모달 표시 여부. false 면 아무것도 렌더하지 않는다. */
  open: boolean
  /** 닫기 요청(백드롭 클릭·ESC·닫기 버튼) 시 호출. */
  onClose: () => void
  /** 헤더에 표시할 제목. 접근성 라벨로도 쓰인다. */
  title: string
  children: React.ReactNode
}

/**
 * 화면 이동 없이 내용을 겹쳐 보여주는 공통 모달.
 * 포털로 body 에 렌더하고, ESC·백드롭 클릭·닫기 버튼으로 닫힌다.
 */
export function Modal({ open, onClose, title, children }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  // 열려 있는 동안 ESC 로 닫고, 포커스를 모달 안에 가두며, 배경 스크롤을 잠근다.
  useEffect(() => {
    if (!open) return

    // 모달을 연 직후의 포커스를 기억해 두고, 닫힐 때 되돌려준다.
    const restoreFocusTo = document.activeElement as HTMLElement | null

    function focusable(): HTMLElement[] {
      const root = dialogRef.current
      if (!root) return []
      return Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        ),
      )
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      // Tab / Shift+Tab 이 모달을 벗어나지 않도록 양 끝에서 순환시킨다.
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()

    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
      restoreFocusTo?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        // 내용 영역 클릭이 백드롭까지 전파돼 닫히지 않도록 막는다.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="닫기">
            <Close className={styles.closeMark} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  )
}
