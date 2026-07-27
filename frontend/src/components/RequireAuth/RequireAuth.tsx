import { useEffect, useRef, useState } from 'react'
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

  // 리다이렉트할 때의 경로만 필요하므로 ref 로 최신 값을 읽는다 — 아래 effect 의 의존성에서
  // location 을 빼기 위해서다(exhaustive-deps 도 이 형태를 만족한다).
  const locationRef = useRef(location)
  locationRef.current = location

  // 가입 완료 여부는 **사용자**의 속성이지 **경로**의 속성이 아니다. 그래서 로그인 상태가
  // 바뀔 때만 확인한다.
  //
  // location 을 의존성에 두면 /chat → /chat/:chatId 처럼 같은 라우트에서 파라미터만 바뀌어도
  // 다시 'checking' 이 되고, 그 사이 아래에서 null 을 반환해 <Outlet /> 이(=보호 화면이)
  // 통째로 언마운트·리마운트된다. 채팅 화면이 URL 이 바뀔 때마다 새로고침된 것처럼 깜빡이고
  // 진행 중이던 대화·목록 스크롤이 사라지던 원인이다.
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
          const { pathname, search } = locationRef.current
          setKakaoReturnTo(pathname + search)
        }
        setRegistration(status)
      })
      .catch(() => {
        if (active) setRegistration('failed')
      })

    return () => {
      active = false
    }
  }, [isAuthed])

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
