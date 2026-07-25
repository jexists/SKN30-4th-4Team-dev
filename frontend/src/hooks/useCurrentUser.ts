import { useEffect, useState } from 'react'

import { getCurrentUser, type CurrentUser } from '../api/auth'

type Status = 'loading' | 'ok' | 'error'

interface CurrentUserState {
  status: Status
  data: CurrentUser | null
  error: unknown
}

let cachedToken: string | null = null
let cachedUser: CurrentUser | null = null
let pendingRequest: Promise<CurrentUser> | null = null

/**
 * 현재 사용자 조회.
 *
 * 토큰별 결과와 진행 중 요청을 공유해 StrictMode 재실행이나 같은 화면의 중복 마운트가
 * /me를 중복 호출하지 않게 한다. 토큰이 바뀌면 이전 사용자의 캐시는 즉시 폐기한다.
 */
function loadCurrentUser(token: string): Promise<CurrentUser> {
  if (cachedToken !== token) {
    cachedToken = token
    cachedUser = null
    pendingRequest = null
  }
  if (cachedUser) return Promise.resolve(cachedUser)
  if (pendingRequest) return pendingRequest

  const requestToken = token
  const request = getCurrentUser()
    .then((user) => {
      if (cachedToken === requestToken) cachedUser = user
      return user
    })
    .finally(() => {
      if (pendingRequest === request) pendingRequest = null
    })
  pendingRequest = request
  return request
}

export function useCurrentUser(token: string | null) {
  const [state, setState] = useState<CurrentUserState>(() =>
    token && cachedToken === token && cachedUser
      ? { status: 'ok', data: cachedUser, error: null }
      : { status: 'loading', data: null, error: null },
  )

  useEffect(() => {
    let active = true

    if (!token) {
      setState({ status: 'loading', data: null, error: null })
      return () => {
        active = false
      }
    }

    setState(
      cachedToken === token && cachedUser
        ? { status: 'ok', data: cachedUser, error: null }
        : { status: 'loading', data: null, error: null },
    )

    void loadCurrentUser(token)
      .then((data) => {
        if (active) setState({ status: 'ok', data, error: null })
      })
      .catch((error: unknown) => {
        if (active) setState({ status: 'error', data: null, error })
      })

    return () => {
      active = false
    }
  }, [token])

  return state
}
