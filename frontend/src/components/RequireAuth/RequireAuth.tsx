import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'

/**
 * 로그인이 필요한 화면을 감싸는 라우트 가드.
 * 비로그인 상태면 /login 으로 보내되, 로그인 후 원래 가려던 곳으로 돌아올 수 있도록
 * 현재 경로를 state.from 에 실어 보낸다. 세션이 끊겨서 튕긴 경우엔 state.expired 로
 * 알려, 로그인 화면이 "왜 튕겼는지" 설명할 수 있게 한다.
 */
export function RequireAuth() {
  const { isAuthed, isLoading, sessionExpired } = useAuth()
  const location = useLocation()

  // 초기 세션을 읽는 중에는 판정을 미룬다.
  // (이걸 건너뛰면 로그인 상태로 새로고침할 때 잠깐 /login 으로 튕긴다.)
  if (isLoading) return null

  if (!isAuthed) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search, expired: sessionExpired }}
      />
    )
  }

  return <Outlet />
}
