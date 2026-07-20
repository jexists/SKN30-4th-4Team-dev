import { useEffect, useState } from 'react'

import { apiGet } from '../api/client'
import type { HealthData } from '../types/api'

type Status = 'loading' | 'ok' | 'error'

export function useHealth() {
  const [status, setStatus] = useState<Status>('loading')
  const [data, setData] = useState<HealthData | null>(null)

  useEffect(() => {
    let active = true
    apiGet<HealthData>('/api/v1/health')
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
