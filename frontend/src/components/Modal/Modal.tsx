import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useOverlayDismiss } from '../../hooks/useOverlayDismiss'
import { Close } from '../icons'
import styles from './Modal.module.scss'

type ModalProps = {
  /** 모달 표시 여부. false 면 아무것도 렌더하지 않는다. */
  open: boolean
  /** 닫기 요청(백드롭 클릭·ESC·닫기 버튼) 시 호출. */
  onClose: () => void
  /** 헤더에 표시할 제목. 접근성 라벨로도 쓰인다. */
  title: string
  /** 열릴 때 우선 포커스할 요소. 없으면 다이얼로그 컨테이너에 포커스한다. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
  /**
   * 본문 중 다이얼로그 설명으로 읽혀야 할 요소의 id. `aria-describedby` 로 연결된다.
   * 포커스가 곧바로 버튼으로 들어가는 모달은 스크린리더가 본문을 건너뛰기 쉬운데,
   * 안내 문구 자체가 존재 이유인 모달(예: 준비 중 안내)에서 이 값을 넘기면 방지된다.
   * 생략하면 `undefined` 로 전달돼 기존 호출부 동작은 그대로다.
   */
  describedBy?: string
  children: React.ReactNode
}

/**
 * 화면 이동 없이 내용을 겹쳐 보여주는 공통 모달.
 * 포털로 body 에 렌더하고, ESC·백드롭 클릭·닫기 버튼으로 닫힌다.
 */
export function Modal({
  open,
  onClose,
  title,
  initialFocusRef,
  describedBy,
  children,
}: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  // 열려 있는 동안 ESC 로 닫고, 포커스를 모달 안에 가두며, 배경 스크롤을 잠근다.
  useOverlayDismiss({ open, onClose, containerRef: dialogRef, initialFocusRef })

  if (!open) return null

  return createPortal(
    <div className={styles.backdrop} onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
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
