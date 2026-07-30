import { useEffect, useRef, useState } from 'react'

import { Pin } from '../icons'
import styles from './KakaoMap.module.scss'
import { isKakaoMapConfigured, loadKakaoMaps } from './loadKakaoMaps'
import { addressCandidates } from './normalizeAddress'

/**
 * 주소 하나를 읽기 전용 카카오 지도로 그린다.
 *
 * **부모가 `position: relative|absolute` 여야 한다** — 이 컴포넌트는 부모를 꽉 채운다.
 *
 * 지도가 못 뜨는 경우(키 미설정·SDK 로드 실패·지오코딩 실패)에도 화면이 비지 않는다.
 * 핀 아이콘 대체 화면이 항상 DOM 에 있고 지도가 준비되면 CSS 로만 감춘다 — 인쇄할 때
 * 라이브 지도 대신 이 대체 화면을 되살리기 위함이다(KakaoMap.module.scss 의 @media print).
 *
 * 실패를 공통 오류 모달(`ErrorState`·`showError`)로 보내지 않는다. 그 정책은 `api/client.ts`
 * 를 타는 우리 API 호출용이다. 애드블록에 막힌 서드파티 SDK 때문에 정상 리포트 위에 모달이
 * 뜨면 사용자에게는 그게 버그다.
 */

interface KakaoMapProps {
  /** 계약서에서 뽑은 주소 원문. 없으면 지도를 시도하지 않는다. */
  address: string | null | undefined
  /** 카카오 확대 레벨 — 작을수록 확대. 기본 4(건물 단위). */
  level?: number
}

type MapState = 'no-address' | 'no-key' | 'loading' | 'ready' | 'not-found' | 'failed'

/** 초기 상태를 동기적으로 정한다 — 무엇을 그릴지 모르는 프레임을 만들지 않는다. */
function initialState(address: string | null | undefined): MapState {
  if (!address?.trim()) return 'no-address'
  if (!isKakaoMapConfigured) return 'no-key'
  return 'loading'
}

/** 후보 주소를 정확한 것부터 순차 시도한다. 첫 성공에서 멈춘다. */
function geocode(maps: KakaoMapsNamespace, candidates: string[]): Promise<KakaoLatLng | null> {
  const geocoder = new maps.services.Geocoder()
  const attempt = (index: number): Promise<KakaoLatLng | null> => {
    if (index >= candidates.length) return Promise.resolve(null)
    return new Promise<KakaoLatLng | null>((resolve) => {
      geocoder.addressSearch(candidates[index], (result, status) => {
        if (status === maps.services.Status.OK && result[0]) {
          resolve(new maps.LatLng(Number(result[0].y), Number(result[0].x)))
        } else {
          resolve(null)
        }
      })
    }).then((hit) => hit ?? attempt(index + 1))
  }
  return attempt(0)
}

export function KakaoMap({ address, level = 4 }: KakaoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<MapState>(() => initialState(address))

  useEffect(() => {
    const next = initialState(address)
    setState(next)
    if (next !== 'loading') return

    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let observer: ResizeObserver | undefined

    loadKakaoMaps()
      .then(async (maps) => {
        if (cancelled) return
        const coords = await geocode(maps, addressCandidates(address!))
        // 지오코더 콜백은 취소할 수 없다. 모든 await 지점 뒤에서 확인하는 것이
        // 언마운트 후 setState 를 막는 유일한 방법이다.
        if (cancelled) return
        if (!coords) {
          setState('not-found')
          return
        }
        const map = new maps.Map(container, {
          center: coords,
          level,
          draggable: false,
          scrollwheel: false,
          disableDoubleClick: true,
          disableDoubleClickZoom: true,
          keyboardShortcuts: false,
        })
        // MapOptions 에는 zoomable 이 없다 — 생성 후 끈다(±버튼·핀치 확대까지 차단).
        map.setZoomable(false)
        map.setDraggable(false)
        new maps.Marker({ position: coords, map })
        // 960px 경계에서 카드 폭이 바뀌면 타일이 회색으로 남는다.
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => map.relayout())
          observer.observe(container)
        }
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('failed')
      })

    return () => {
      cancelled = true
      observer?.disconnect()
      // 카카오 지도에는 destroy API 가 없다. 컨테이너를 비우는 것이 공식적인 정리 방법이고,
      // StrictMode 이중 실행에서 지도가 두 겹 겹치는 것도 이걸로 막는다.
      container.innerHTML = ''
    }
  }, [address, level])

  return (
    <div className={styles.root} data-state={state}>
      <div ref={containerRef} className={styles.canvas} />
      {/* 대체 화면은 항상 DOM 에 두고 CSS 로만 감춘다 — 인쇄에서 되살린다. */}
      <div className={styles.fallback} aria-hidden="true">
        <Pin className={styles.fallbackIcon} />
        {(state === 'not-found' || state === 'failed') && (
          <p className={styles.fallbackText}>지도에서 위치를 찾지 못했습니다</p>
        )}
      </div>
    </div>
  )
}
