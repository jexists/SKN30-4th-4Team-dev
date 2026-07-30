import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { KakaoMap } from './KakaoMap'

const isKakaoMapConfigured = vi.hoisted(() => ({ value: false }))
const loadKakaoMaps = vi.hoisted(() => vi.fn())

// 로더를 목킹한다 — 실제 SDK 는 jsdom 에 없고, 있어도 네트워크를 타면 안 된다.
vi.mock('./loadKakaoMaps', () => ({
  get isKakaoMapConfigured() {
    return isKakaoMapConfigured.value
  },
  loadKakaoMaps,
}))

/** addressSearch 응답을 순서대로 물려줄 수 있는 가짜 SDK. */
function fakeMaps(statuses: KakaoAddressStatus[]) {
  const addressSearch = vi.fn(
    (address: string, cb: Parameters<KakaoGeocoder['addressSearch']>[1]) => {
      void address
      const status = statuses.shift() ?? 'ZERO_RESULT'
      cb(status === 'OK' ? [{ x: '127.0', y: '37.5' }] : [], status)
    },
  )
  const mapInstance = {
    relayout: vi.fn(),
    setCenter: vi.fn(),
    setDraggable: vi.fn(),
    setZoomable: vi.fn(),
  }
  const Map = vi.fn(() => mapInstance)
  const Marker = vi.fn(() => ({ setMap: vi.fn() }))
  const maps = {
    load: (cb: () => void) => cb(),
    LatLng: vi.fn(function (this: unknown, lat: number, lng: number) {
      return { getLat: () => lat, getLng: () => lng }
    }),
    Map,
    Marker,
    services: {
      Geocoder: vi.fn(() => ({ addressSearch })),
      Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
    },
  } as unknown as KakaoMapsNamespace
  return { maps, addressSearch, Map, Marker, mapInstance }
}

function stateOf(container: HTMLElement) {
  return container.querySelector('[data-state]')?.getAttribute('data-state')
}

beforeEach(() => {
  isKakaoMapConfigured.value = false
  loadKakaoMaps.mockReset()
  document.head.querySelectorAll('script').forEach((el) => el.remove())
})

describe('KakaoMap', () => {
  it('키가 없으면 SDK 를 요청하지 않고 대체 화면만 그린다', () => {
    const { container } = render(<KakaoMap address="서울특별시 강남구 테헤란로 123" />)

    expect(stateOf(container)).toBe('no-key')
    expect(loadKakaoMaps).not.toHaveBeenCalled()
    // 키 없이 dapi.kakao.com 을 건드리면 모든 페이지가 인증 실패를 뿜는다.
    expect(document.querySelector('script[src*="dapi.kakao.com"]')).toBeNull()
  })

  it('주소가 없으면 지오코딩을 시도하지 않는다', () => {
    isKakaoMapConfigured.value = true
    const { container } = render(<KakaoMap address={null} />)

    expect(stateOf(container)).toBe('no-address')
    expect(loadKakaoMaps).not.toHaveBeenCalled()
  })

  it('지오코딩이 성공하면 읽기 전용 지도와 마커를 만든다', async () => {
    isKakaoMapConfigured.value = true
    const { maps, Map, Marker, mapInstance } = fakeMaps(['OK'])
    loadKakaoMaps.mockResolvedValue(maps)

    const { container } = render(<KakaoMap address="서울특별시 강남구 테헤란로 123" />)

    await waitFor(() => expect(stateOf(container)).toBe('ready'))
    expect(Map).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({ draggable: false, level: 4 }),
    )
    expect(mapInstance.setZoomable).toHaveBeenCalledWith(false)
    expect(Marker).toHaveBeenCalledTimes(1)
  })

  it('정확한 주소가 실패하면 상세를 떼어낸 후보로 다시 시도한다', async () => {
    isKakaoMapConfigured.value = true
    const { maps, addressSearch } = fakeMaps(['ZERO_RESULT', 'OK'])
    loadKakaoMaps.mockResolvedValue(maps)

    const { container } = render(
      <KakaoMap address="서울특별시 강남구 테헤란로 123, 제3층 제301호" />,
    )

    await waitFor(() => expect(stateOf(container)).toBe('ready'))
    expect(addressSearch.mock.calls[0][0]).toBe('서울특별시 강남구 테헤란로 123, 제3층 제301호')
    expect(addressSearch.mock.calls[1][0]).toBe('서울특별시 강남구 테헤란로 123')
  })

  it('모든 후보가 실패하면 안내 문구를 보여준다', async () => {
    isKakaoMapConfigured.value = true
    const { maps } = fakeMaps(['ZERO_RESULT', 'ZERO_RESULT'])
    loadKakaoMaps.mockResolvedValue(maps)

    const { container } = render(<KakaoMap address="없는 주소 123, 제3층" />)

    await waitFor(() => expect(stateOf(container)).toBe('not-found'))
    expect(screen.getByText('지도에서 위치를 찾지 못했습니다')).toBeInTheDocument()
  })

  it('SDK 로드 실패는 화면을 깨뜨리지 않는다', async () => {
    isKakaoMapConfigured.value = true
    loadKakaoMaps.mockRejectedValue(new Error('SDK_LOAD_FAILED'))

    const { container } = render(<KakaoMap address="서울특별시 강남구 테헤란로 123" />)

    await waitFor(() => expect(stateOf(container)).toBe('failed'))
    expect(screen.getByText('지도에서 위치를 찾지 못했습니다')).toBeInTheDocument()
  })

  it('지오코딩 중 언마운트되면 지도를 만들지 않는다', async () => {
    isKakaoMapConfigured.value = true
    let respond: (() => void) | undefined
    const Map = vi.fn(() => ({
      relayout: vi.fn(),
      setCenter: vi.fn(),
      setDraggable: vi.fn(),
      setZoomable: vi.fn(),
    }))
    const maps = {
      load: (cb: () => void) => cb(),
      LatLng: vi.fn(() => ({ getLat: () => 37.5, getLng: () => 127 })),
      Map,
      Marker: vi.fn(() => ({ setMap: vi.fn() })),
      services: {
        Geocoder: vi.fn(() => ({
          // 콜백을 붙잡아 두고 언마운트 후에 답한다.
          addressSearch: (_address: string, cb: Parameters<KakaoGeocoder['addressSearch']>[1]) => {
            respond = () => cb([{ x: '127.0', y: '37.5' }], 'OK')
          },
        })),
        Status: { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' },
      },
    } as unknown as KakaoMapsNamespace
    loadKakaoMaps.mockResolvedValue(maps)

    const { unmount } = render(<KakaoMap address="서울특별시 강남구 테헤란로 123" />)
    await waitFor(() => expect(respond).toBeDefined())
    unmount()
    respond!()

    await Promise.resolve()
    expect(Map).not.toHaveBeenCalled()
  })
})
