import '@testing-library/jest-dom'

/**
 * jsdom 에는 matchMedia 가 없다 — hooks/useMediaQuery 를 쓰는 화면이 렌더되는 순간
 * 전부 터지므로 데스크탑(`matches: false`) 기본값으로 채운다.
 *
 * 모바일 레이아웃을 검증하는 테스트는 개별적으로 이 스텁을 덮어쓴다.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
