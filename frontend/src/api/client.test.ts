import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 401 처리 회귀 테스트.
 *
 * 재현하려는 사고: 하루 지난 세션으로 앱에 들어오면 화면은 로그인 상태로 남은 채
 * 모든 API 가 401 을 뱉었다. 서버의 401 이 인증 상태로 되돌아오지 않았기 때문이다.
 */

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
}))
const store = vi.hoisted(() => ({ expireSession: vi.fn() }))
const ui = vi.hoisted(() => ({ showError: vi.fn(), showToast: vi.fn() }))

vi.mock('../config/supabase', () => ({
  supabase: { auth },
  isAuthConfigured: true,
}))
vi.mock('../hooks/useAuth', () => ({ expireSession: store.expireSession }))
vi.mock('../components/ErrorModal/errorModalStore', () => ({ showError: ui.showError }))
vi.mock('../components/Toast/toastStore', () => ({ showToast: ui.showToast }))

const { apiGet, apiPost, ApiError } = await import('./client')

/** 백엔드 표준 응답 봉투. */
function envelope(status: number, body: unknown) {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

/** message 는 토스트 전용이라 기본은 빈 문자열이다(성공마다 토스트가 뜨면 안 된다). */
function ok<T>(data: T, message = '') {
  return envelope(200, { success: true, code: 200, message, data, error: null })
}

function unauthorized(title = '로그인 필요') {
  return envelope(401, {
    success: false,
    code: 401,
    message: '',
    data: null,
    error: { title, message: '로그인이 필요합니다.' },
  })
}

function failure(status: number, title: string, message: string, toast = '') {
  return envelope(status, {
    success: false,
    code: status,
    message: toast,
    data: null,
    error: { title, message },
  })
}

function sessionWith(token: string) {
  return { data: { session: { access_token: token } }, error: null }
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  auth.getSession.mockReset()
  auth.refreshSession.mockReset()
  store.expireSession.mockReset()
  ui.showError.mockReset()
  ui.showToast.mockReset()
  auth.getSession.mockResolvedValue(sessionWith('old-token'))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** n 번째 fetch 호출에 실린 Authorization 헤더. */
function authHeaderOf(callIndex: number): string | undefined {
  const init = fetchMock.mock.calls[callIndex][1] as { headers: Record<string, string> }
  return init.headers.Authorization
}

describe('apiGet/apiPost 의 401 처리', () => {
  it('정상 응답이면 data 만 벗겨서 준다', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'room-1' }))

    await expect(apiGet<{ id: string }>('/api/v1/chat/rooms')).resolves.toEqual({ id: 'room-1' })
    expect(authHeaderOf(0)).toBe('Bearer old-token')
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('401 이면 세션을 한 번 갱신해 새 토큰으로 재시도한다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok({ id: 'room-1' }))
    auth.refreshSession.mockResolvedValue(sessionWith('fresh-token'))

    await expect(apiPost<{ id: string }>('/api/v1/chat/rooms', { title: 'ㅎㅇ' })).resolves.toEqual(
      {
        id: 'room-1',
      },
    )

    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(authHeaderOf(0)).toBe('Bearer old-token')
    expect(authHeaderOf(1)).toBe('Bearer fresh-token')
    expect(store.expireSession).not.toHaveBeenCalled()
  })

  it('갱신에 실패하면 로그아웃 처리하고 ApiError 를 던진다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('nope') })

    await expect(apiPost('/api/v1/chat/rooms', {})).rejects.toBeInstanceOf(ApiError)

    expect(store.expireSession).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1) // 갱신 실패 시 재시도하지 않는다
  })

  it('갱신에 성공했는데도 다시 401 이면 로그아웃 처리하고 무한 재시도하지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(unauthorized())
    auth.refreshSession.mockResolvedValue(sessionWith('fresh-token'))

    await expect(apiGet('/api/v1/chat/rooms')).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(auth.refreshSession).toHaveBeenCalledTimes(1)
    expect(store.expireSession).toHaveBeenCalledTimes(1)
  })

  it('인증 서버 장애(503)로는 로그아웃시키지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(
      envelope(503, {
        success: false,
        code: 503,
        message: '인증 서버에 연결할 수 없습니다.',
        data: null,
        error: { title: 'AUTH_UNAVAILABLE', message: '인증 서버에 연결할 수 없습니다.' },
      }),
    )

    await expect(apiGet('/api/v1/me')).rejects.toMatchObject({ code: 503 })

    expect(store.expireSession).not.toHaveBeenCalled()
    expect(auth.refreshSession).not.toHaveBeenCalled()
  })

  it('getSession 이 실패하면 인증 헤더 없이 보내고, 401 이면 로그아웃 처리한다', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new Error('offline') })
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('offline') })
    fetchMock.mockResolvedValueOnce(unauthorized())

    await expect(apiGet('/api/v1/chat/rooms')).rejects.toBeInstanceOf(ApiError)

    expect(authHeaderOf(0)).toBeUndefined()
    expect(store.expireSession).toHaveBeenCalledTimes(1)
  })
})

/**
 * 공통 에러 처리 정책.
 *
 * 화면마다 따로 구현하지 않기 위해 봉투 해석을 여기 한 곳에 모았다 — 이 테스트가
 * 그 계약(message=토스트 / error=모달)을 고정한다.
 */
describe('공통 토스트·오류 모달 처리', () => {
  it('message 가 있으면 토스트로 띄운다', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'room-1' }, '대화 제목을 수정했습니다.'))

    await apiGet('/api/v1/chat/rooms')

    expect(ui.showToast).toHaveBeenCalledWith('대화 제목을 수정했습니다.', 'success')
    expect(ui.showError).not.toHaveBeenCalled()
  })

  it('message 가 비어 있으면 토스트를 띄우지 않는다', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: 'room-1' }))

    await apiGet('/api/v1/chat/rooms')

    expect(ui.showToast).not.toHaveBeenCalled()
  })

  it('실패하면 서버가 준 error.title·message 로 오류 모달을 띄운다', async () => {
    fetchMock.mockResolvedValueOnce(failure(500, '서버 오류', '잠시 후 다시 시도해 주세요.'))

    await expect(apiGet('/api/v1/chat/rooms')).rejects.toBeInstanceOf(ApiError)

    expect(ui.showError).toHaveBeenCalledWith('서버 오류', '잠시 후 다시 시도해 주세요.')
  })

  it('401 은 모달을 띄우지 않는다 — 이미 로그아웃되어 로그인 화면으로 간다', async () => {
    fetchMock.mockResolvedValueOnce(unauthorized())
    auth.refreshSession.mockResolvedValue({ data: { session: null }, error: new Error('nope') })

    await expect(apiGet('/api/v1/chat/rooms')).rejects.toBeInstanceOf(ApiError)

    expect(store.expireSession).toHaveBeenCalledTimes(1)
    expect(ui.showError).not.toHaveBeenCalled()
  })

  it('응답이 JSON 이 아니면 네트워크 오류로 알린다', async () => {
    // 백엔드가 죽어 프록시가 HTML 502 를 주는 상황. 예전엔 처리되지 않고 새어 나갔다.
    fetchMock.mockResolvedValueOnce({
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    } as unknown as Response)

    await expect(apiGet('/api/v1/chat/rooms')).rejects.toBeInstanceOf(SyntaxError)

    expect(ui.showError).toHaveBeenCalledWith(
      '네트워크 오류',
      '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    )
  })

  it('fetch 자체가 실패하면 네트워크 오류로 알린다', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(apiGet('/api/v1/chat/rooms')).rejects.toBeInstanceOf(TypeError)

    expect(ui.showError).toHaveBeenCalledWith(
      '네트워크 오류',
      '인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
    )
  })

  it('silent 면 토스트도 모달도 띄우지 않는다 (화면이 직접 표현하는 예외)', async () => {
    fetchMock.mockResolvedValueOnce(failure(500, '서버 오류', '잠시 후 다시 시도해 주세요.', '토스트'))

    await expect(
      apiPost('/api/v1/chat', { message: '안녕' }, { silent: true }),
    ).rejects.toBeInstanceOf(ApiError)

    expect(ui.showError).not.toHaveBeenCalled()
    expect(ui.showToast).not.toHaveBeenCalled()
  })
})
