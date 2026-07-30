/**
 * 카카오맵 SDK 중 실제로 쓰는 부분만 손으로 선언한다.
 *
 * `kakao.maps.d.ts` 패키지를 쓰지 않는 이유: `tsconfig.json` 이 `compilerOptions.types` 를
 * 고정하고 있어 tsconfig 를 함께 손봐야 하고, 우리가 부르는 API 는 아래 몇 개뿐이다.
 *
 * **`declare namespace kakao` 로 전역 값을 만들지 않는다.** 그러면 SDK 가 로드되지 않은
 * 상태에서도 `kakao.maps...` 가 컴파일을 통과하고 런타임에 터진다. 반드시 optional 인
 * `window.kakao` 를 통해서만 접근하게 해서, 타입 검사기가 존재 확인을 강제하도록 둔다.
 */

interface KakaoLatLng {
  getLat(): number
  getLng(): number
}

interface KakaoMapInstance {
  /** 컨테이너 크기가 바뀐 뒤 타일을 다시 그린다. 안 부르면 회색으로 남는다. */
  relayout(): void
  setCenter(latlng: KakaoLatLng): void
  setDraggable(draggable: boolean): void
  setZoomable(zoomable: boolean): void
}

interface KakaoMarker {
  setMap(map: KakaoMapInstance | null): void
}

type KakaoAddressStatus = 'OK' | 'ZERO_RESULT' | 'ERROR'

interface KakaoAddressResult {
  /** 경도 */
  x: string
  /** 위도 */
  y: string
}

interface KakaoGeocoder {
  addressSearch(
    address: string,
    callback: (result: KakaoAddressResult[], status: KakaoAddressStatus) => void,
  ): void
}

interface KakaoMapsNamespace {
  /** `autoload=false` 로 불러온 SDK 의 초기화 완료 신호. */
  load(callback: () => void): void
  LatLng: new (lat: number, lng: number) => KakaoLatLng
  Map: new (
    container: HTMLElement,
    options: {
      center: KakaoLatLng
      level?: number
      draggable?: boolean
      scrollwheel?: boolean
      disableDoubleClick?: boolean
      disableDoubleClickZoom?: boolean
      keyboardShortcuts?: boolean
    },
  ) => KakaoMapInstance
  Marker: new (options: { position: KakaoLatLng; map?: KakaoMapInstance }) => KakaoMarker
  /** `libraries=services` 로 불러야 존재한다. */
  services: {
    Geocoder: new () => KakaoGeocoder
    Status: { OK: 'OK'; ZERO_RESULT: 'ZERO_RESULT'; ERROR: 'ERROR' }
  }
}

interface Window {
  kakao?: { maps: KakaoMapsNamespace }
}
