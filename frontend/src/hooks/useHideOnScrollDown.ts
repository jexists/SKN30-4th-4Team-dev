import { useCallback, useRef, useState } from 'react'

/** 이 픽셀만큼 움직여야 방향이 바뀐 것으로 본다 — 손가락 떨림에 버튼이 깜빡이지 않게. */
const DELTA = 8
/** 맨 위 이 범위 안에서는 항상 보여준다(스크롤을 조금 내렸다고 감추면 답답하다). */
const TOP_ZONE = 24

/**
 * 아래로 스크롤하면 감추고 위로 올리면 다시 보여주는 토글.
 *
 * 콘텐츠 위에 겹쳐 뜨는 요소가 읽기를 방해하지 않게 하는 흔한 패턴이다.
 * 스크롤 컨테이너를 직접 잡지 않고 핸들러를 돌려주므로, 컨테이너를 소유한 컴포넌트가
 * `onScroll` 로 연결하기만 하면 된다(ref 를 밖으로 끌어낼 필요가 없다).
 */
export function useHideOnScrollDown() {
  const [hidden, setHidden] = useState(false)
  const lastY = useRef(0)

  const onScroll = useCallback((event: React.UIEvent<HTMLElement>) => {
    const y = event.currentTarget.scrollTop
    const delta = y - lastY.current
    if (Math.abs(delta) < DELTA) return
    lastY.current = y
    setHidden(y > TOP_ZONE && delta > 0)
  }, [])

  /** 대화를 바꾸는 등 스크롤 위치가 초기화될 때 다시 보여준다. */
  const reveal = useCallback(() => {
    lastY.current = 0
    setHidden(false)
  }, [])

  return { hidden, onScroll, reveal }
}
