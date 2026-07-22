import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../../hooks/useAuth'

/**
 * 로그인이 필요한 화면을 감싸는 라우트 가드.
 * 비로그인 상태면 /login 으로 보내되, 로그인 후 원래 가려던 곳으로 돌아올 수 있도록
 * 현재 경로를 state.from 에 실어 보낸다.
 */
export function RequireAuth() {
  const { isAuthed } = useAuth()
  const location = useLocation()

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  return <Outlet />
}
