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

vi.mock('../config/supabase', () => ({
  supabase: { auth },
  isAuthConfigured: true,
}))
vi.mock('../hooks/useAuth', () => ({ expireSession: store.expireSession }))

const { apiGet, apiPost, ApiError } = await import('./client')

/** 백엔드 표준 응답 봉투. */
function envelope(status: number, body: unknown) {
  return {
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function ok<T>(data: T) {
  return envelope(200, { success: true, code: 200, message: 'ok', data, error: null })
}

function unauthorized(title = 'UNAUTHORIZED') {
  return envelope(401, {
    success: false,
    code: 401,
    message: '로그인이 필요합니다.',
    data: null,
    error: { title, message: '로그인이 필요합니다.' },
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
