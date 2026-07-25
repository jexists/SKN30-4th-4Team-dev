import { useEffect, useState } from 'react'

import { apiGet } from '../api/client'
import type { HealthData } from '../types/api'

type Status = 'loading' | 'ok' | 'error'

export function useHealth() {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<HealthData | null>(null)

  useEffect(() => {
    let active = true
    // 상태 위젯용 조회다 — 서버가 죽어 있을 때 오류 모달을 띄우는 건 이 화면의 몫이 아니다.
    apiGet<HealthData>('/api/v1/health', { silent: true })
      .then((d) => {
        if (active) {
          setData(d)
          setStatus('ok')
        }
      })
      .catch(() => {
        if (active) setStatus('error')
      })
    return () => {
      active = false
    }
  }, [])

  return { status, data }
}
