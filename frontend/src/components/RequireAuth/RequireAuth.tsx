import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { getRegistration, type RegistrationStatus } from '../../api/kakaoAuth'
import { setKakaoReturnTo } from '../../auth/kakaoOAuth'
import { isAuthConfigured } from '../../config/supabase'
import { useAuth } from '../../hooks/useAuth'

type GuardStatus = RegistrationStatus | 'checking' | 'failed'

/** JWT 인증과 app_user 회원가입 완료를 함께 확인하는 라우트 가드. */
export function RequireAuth() {
  const { isAuthed, isLoading, sessionExpired } = useAuth()
  const location = useLocation()
  const [registration, setRegistration] = useState<GuardStatus>(
    isAuthConfigured ? 'checking' : 'authenticated',
  )

  useEffect(() => {
    if (!isAuthed || !isAuthConfigured) {
      setRegistration(isAuthConfigured ? 'checking' : 'authenticated')
      return
    }

    let active = true
    setRegistration('checking')
    void getRegistration()
      .then(({ status }) => {
        if (!active) return
        if (status === 'signup_required') {
          setKakaoReturnTo(location.pathname + location.search)
        }
        setRegistration(status)
      })
      .catch(() => {
        if (active) setRegistration('failed')
      })

    return () => {
      active = false
    }
  }, [isAuthed, location.pathname, location.search])

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

  if (registration === 'checking') return null
  if (registration === 'signup_required') {
    return <Navigate to="/signup?mode=kakao" replace />
  }
  if (registration === 'failed') {
    return <p role="alert">회원 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
  }

  return <Outlet />
}
