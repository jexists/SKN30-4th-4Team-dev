import { useEffect, useState } from 'react'

import { listAnalyses } from '../api/analyses'
import { showToast } from '../components/Toast/toastStore'
import type { AnalysisJobSummary, RiskLevel } from '../types/analysis'
import { isTerminal } from '../types/analysis'

/**
 * 내 분석 목록 — 마이페이지의 "최근 진단 내역" 과 `/risk-report` 목록 화면이 함께 쓴다.
 *
 * 목록에는 요약만 오므로(결과 payload 없음) 가볍다. 두 화면이 같은 데이터를 그리므로
 * 훅과 표현 헬퍼만 공용으로 두고, 행 마크업·스타일은 각 화면이 자기 톤으로 그린다.
 */

/** `2026.05.20 14:30` — 목록에서 한 줄로 읽히는 형식. */
export function formatAnalyzedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 카드 제목 — 서버가 준 요약 제목, 없으면 첫 파일명, 그것도 없으면 기본 문구. */
export function analysisTitle(job: AnalysisJobSummary): string {
  return job.title || job.file_names[0] || '계약서 분석'
}

/** 배지 색 키. 화면별 CSS Module 이 `level_safe` 같은 이름으로 받는다. */
export type RiskTone = 'safe' | 'caution' | 'risk' | 'neutral'

const LEVEL_STYLE: Record<RiskLevel, RiskTone> = { LOW: 'safe', MEDIUM: 'caution', HIGH: 'risk' }
const LEVEL_LABEL: Record<RiskLevel, string> = {
  LOW: 'SAFE (안전)',
  MEDIUM: 'CAUTION (주의)',
  HIGH: 'HIGH RISK (위험)',
}

/**
 * 끝났는데 보여줄 등급이 없다 = 실패(취소·결과 없음 포함).
 *
 * **열어도 리포트가 없으므로 목록에서 누를 수 없게 하는 기준**이기도 하다. 진행 중은 실패가
 * 아니다 — 그 항목은 진행 화면이 이어서 폴링한다.
 */
export function isAnalysisFailed(job: AnalysisJobSummary): boolean {
  if (!isTerminal(job.status)) return false
  return !(job.status === 'SUCCEEDED' && job.risk_level !== null)
}

/** 목록 배지 — 등급이 나왔으면 등급, 아직이면 진행/실패. */
export function riskBadge(job: AnalysisJobSummary): { label: string; tone: RiskTone } {
  if (job.status === 'SUCCEEDED' && job.risk_level !== null) {
    return { label: LEVEL_LABEL[job.risk_level], tone: LEVEL_STYLE[job.risk_level] }
  }
  return { label: isAnalysisFailed(job) ? '분석 실패' : '분석 중', tone: 'neutral' }
}

/**
 * 최신순 커서 페이지네이션. `limit` 은 화면이 정한다(마이페이지 5건, 목록 화면 5건).
 *
 * 실패를 빈 목록으로 그리지 않는다 — 서버 장애가 "진단한 적 없음"으로 보이면 안 된다.
 * 재시도 버튼을 보일지는 화면이 `isRetryable(error)` 로 정하므로 잡은 오류를 그대로 넘긴다.
 */
export function useAnalysisHistory(limit = 5) {
  const [items, setItems] = useState<AnalysisJobSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState<unknown>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    listAnalyses(null, limit)
      .then((page) => {
        if (cancelled) return
        setItems(page.items)
        setNextCursor(page.next_cursor)
        setError(null)
        setStatus('ok')
      })
      .catch((caught) => {
        if (cancelled) return
        setError(caught)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [limit, reloadKey])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await listAnalyses(nextCursor, limit)
      setItems((prev) => [...prev, ...page.items])
      setNextCursor(page.next_cursor)
    } catch {
      showToast('진단 내역을 더 불러오지 못했습니다.', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  /**
   * 수정·삭제 결과를 목록에 반영한다. 다시 조회하지 않는 이유: 재조회하면 지금까지 "더 보기"
   * 로 이어붙인 페이지가 첫 페이지로 되감기고 커서도 어긋난다.
   */
  function applyTitle(jobId: string, title: string) {
    setItems((prev) => prev.map((item) => (item.id === jobId ? { ...item, title } : item)))
  }

  function removeItem(jobId: string) {
    setItems((prev) => prev.filter((item) => item.id !== jobId))
  }

  return {
    items,
    status,
    error,
    hasMore: nextCursor !== null,
    loadingMore,
    loadMore,
    applyTitle,
    removeItem,
    retry: () => setReloadKey((key) => key + 1),
  }
}
