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
 * 캐시가 바뀔 때 알려줄 구독자들.
 *
 * 프로필은 한 화면에서 바꿔도 여러 곳(마이페이지 + 헤더 아바타)에 동시에 보인다.
 * 캐시만 갱신하면 갱신을 일으킨 컴포넌트만 다시 그려지고 나머지는 옛 값을 들고 있게 된다.
 */
const subscribers = new Set<(user: CurrentUser) => void>()

function publish(user: CurrentUser) {
  for (const notify of [...subscribers]) notify(user)
}

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

  // 다른 곳에서 프로필을 갱신하면(예: 마이페이지의 사진 변경) 이 인스턴스도 따라간다.
  useEffect(() => {
    if (!token) return
    const notify = (user: CurrentUser) => setState({ status: 'ok', data: user, error: null })
    subscribers.add(notify)
    return () => {
      subscribers.delete(notify)
    }
  }, [token])

  /** 닉네임 변경처럼 서버가 최신 사용자를 돌려주는 저장 뒤, 재조회 없이 화면·캐시를 갱신한다. */
  function setCurrentUser(user: CurrentUser) {
    if (token) cachedUser = user
    // 자기 자신은 구독과 무관하게 갱신한다 — 구독 effect 가 아직 안 붙은 시점에도 동작해야 한다.
    setState({ status: 'ok', data: user, error: null })
    publish(user)
  }

  return { ...state, setCurrentUser }
}
