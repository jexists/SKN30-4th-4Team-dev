import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'
import { Close } from '../icons'
import styles from './Drawer.module.scss'

type DrawerProps = {
  /** 드로어 표시 여부. false 면 아무것도 렌더하지 않는다. */
  open: boolean
  /** 닫기 요청(백드롭 클릭·ESC·닫기 버튼) 시 호출. */
  onClose: () => void
  /** 헤더에 표시할 제목. 접근성 라벨로도 쓰인다. */
  title: string
  children: React.ReactNode
}

/**
 * 화면 좌측에서 밀려 나오는 공통 드로어 — 모바일에서 사이드바 자리를 대신한다.
 *
 * Modal 과 동작(ESC·포커스 트랩·스크롤 잠금·포커스 복원)은 같고 배치만 다르므로
 * 공통 부분은 useOverlayDismiss 를 함께 쓴다. 포털로 body 에 렌더하기 때문에
 * overflow:hidden 인 앱 셸(App.module.scss 의 .chatLayout) 에 잘리지 않는다.
 */
export function Drawer({ open, onClose, title, children }: DrawerProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useOverlayDismiss({ open, onClose, containerRef: panelRef })

  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        ref={panelRef}
        className={styles.panel}
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
