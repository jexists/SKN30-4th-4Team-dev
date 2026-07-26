import { useEffect } from 'react'

type Options = {
  /** 오버레이가 열려 있는지. false 면 아무것도 하지 않는다. */
  open: boolean
  /** ESC 로 닫기 요청. */
  onClose: () => void
  /** 포커스를 가둘 컨테이너. 자기 자신도 포커스 대상이 되도록 tabIndex={-1} 을 준다. */
  containerRef: React.RefObject<HTMLElement | null>
  /** 열릴 때 우선 포커스할 요소. 없으면 컨테이너에 포커스한다. */
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

/**
 * 모달·드로어 공통 동작 — ESC 닫기, 포커스 트랩, 배경 스크롤 잠금, 포커스 복원.
 *
 * 화면을 덮는 오버레이는 종류가 달라도 이 네 가지를 똑같이 해야 하므로 한곳에 둔다.
 * (Modal 은 가운데 다이얼로그, Drawer 는 좌측 슬라이드 — 다른 건 레이아웃뿐이다.)
 */
export function useOverlayDismiss({ open, onClose, containerRef, initialFocusRef }: Options) {
  useEffect(() => {
    if (!open) return

    // 오버레이를 연 직후의 포커스를 기억해 두고, 닫힐 때 되돌려준다.
    const restoreFocusTo = document.activeElement as HTMLElement | null

    function focusable(): HTMLElement[] {
      const root = containerRef.current
      if (!root) return []
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      // Tab / Shift+Tab 이 오버레이를 벗어나지 않도록 양 끝에서 순환시킨다.
      const items = focusable()
      if (items.length === 0) {
        e.preventDefault()
        containerRef.current?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === containerRef.current)) {
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
    ;(initialFocusRef?.current ?? containerRef.current)?.focus()

    return () => {
      document.removeEventListener('keydown', handleKey)
      document.body.style.overflow = prevOverflow
      restoreFocusTo?.focus?.()
    }
  }, [containerRef, initialFocusRef, open, onClose])
}
