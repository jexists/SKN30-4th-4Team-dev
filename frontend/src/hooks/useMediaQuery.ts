import { useCallback, useSyncExternalStore } from 'react'

/**
 * 모바일 판정 쿼리 — `styles/_variables.scss` 의 `$bp-lg` (820px) 와 같은 값을 쓴다.
 *
 * SCSS 토큰을 JS 로 읽어올 방법이 없어 두 곳에 값이 존재한다. 브레이크포인트를 바꿀 때는
 * 반드시 둘을 함께 고친다 — 어긋나면 CSS 는 데스크탑, JS 는 모바일로 갈려 UI 가 사라진다.
 */
export const MOBILE_QUERY = '(max-width: 820px)'

/** matchMedia 가 없는 환경(구형 브라우저·SSR·jsdom) 에서는 데스크탑으로 본다. */
function matchMedia(query: string): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query)
    : null
}

/** 미디어 쿼리 일치 여부를 구독한다. 리사이즈 이벤트보다 싸고 정확하다. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = matchMedia(query)
      if (!mql) return () => {}
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )

  const getSnapshot = useCallback(() => matchMedia(query)?.matches ?? false, [query])

  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/**
 * 모바일 레이아웃인지.
 *
 * CSS 로 감추지 않고 JS 로 분기하는 이유: 데스크탑 사이드바와 모바일 드로어를 동시에
 * 마운트하면 무한스크롤 sentinel 이 둘이 되어 같은 페이지를 두 번 요청한다.
 */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}
