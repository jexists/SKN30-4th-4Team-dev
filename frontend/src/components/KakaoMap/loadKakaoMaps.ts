import { ENV } from '../../config/env'

/**
 * 카카오맵 SDK 로더.
 *
 * `index.html` 에 `<script>` 를 박지 않는다: ① 키 치환이 `import.meta.env` 를 읽는 두 번째
 * 장소가 되고(`config/env.ts` 만 읽는다는 규칙 위반), ② 지도를 안 쓰는 모든 페이지가 SDK 를
 * 내려받고, ③ 키가 비어 있으면 모든 페이지가 인증 실패를 콘솔에 뿜는다.
 */

const SDK_ID = 'kakao-maps-sdk'
/** 네트워크가 조용히 멈춰도 로딩 상태에 영구히 갇히지 않게 한다. */
const TIMEOUT_MS = 8_000

/** 키가 없으면 SDK 를 **요청하지 않는다** — 지도 대신 대체 화면이 뜬다. */
export const isKakaoMapConfigured = ENV.kakaoMapJsKey !== ''

/**
 * `autoload=false` 가 필수다. 기본값(true)이면 스크립트 평가 즉시 초기화를 시작해
 * `services` 준비 시점을 알 수 없다. false 로 두고 `load(cb)` 로 완료를 받는다.
 * `libraries=services` 가 있어야 `Geocoder` 가 생긴다.
 */
const sdkSrc = (key: string) =>
  `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=services&autoload=false`

/** 스크립트는 문서에 하나뿐이고 모든 마운트가 이 promise 를 공유한다(StrictMode 이중 실행 포함). */
let pending: Promise<KakaoMapsNamespace> | null = null

export function loadKakaoMaps(): Promise<KakaoMapsNamespace> {
  if (!isKakaoMapConfigured) return Promise.reject(new Error('NO_KEY'))
  if (pending) return pending

  pending = new Promise<KakaoMapsNamespace>((resolve, reject) => {
    // HMR 로 이 모듈만 다시 평가된 경우 — 스크립트는 이미 붙어 있다.
    // 이미 발생한 load 이벤트는 다시 오지 않으므로 기존 엘리먼트에 리스너를 달면 영구 대기가 된다.
    // `load(cb)` 는 초기화가 끝난 뒤에 불러도 곧바로 콜백한다.
    if (window.kakao?.maps) {
      window.kakao.maps.load(() => resolve(window.kakao!.maps))
      return
    }

    const fail = (reason: string) => {
      pending = null // 다음 마운트가 다시 시도할 수 있게 비운다.
      reject(new Error(reason))
    }
    const timer = window.setTimeout(() => fail('SDK_TIMEOUT'), TIMEOUT_MS)

    const script = document.createElement('script')
    script.id = SDK_ID
    script.async = true
    script.src = sdkSrc(ENV.kakaoMapJsKey)
    script.addEventListener(
      'load',
      () => {
        window.clearTimeout(timer)
        // 키가 틀렸거나 플랫폼에 도메인이 등록되지 않으면 200 응답인데도 kakao 가 없다.
        // 키를 넣었는데 지도가 안 뜨면 코드보다 도메인 등록을 먼저 확인할 것.
        if (!window.kakao?.maps) {
          fail('SDK_INVALID_KEY')
          return
        }
        window.kakao.maps.load(() => resolve(window.kakao!.maps))
      },
      { once: true },
    )
    script.addEventListener(
      'error',
      () => {
        window.clearTimeout(timer)
        fail('SDK_LOAD_FAILED')
      },
      { once: true },
    )
    document.head.appendChild(script)
  })
  return pending
}
