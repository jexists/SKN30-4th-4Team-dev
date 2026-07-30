import type { ContractAnalysis } from './document'

/**
 * 분석 작업 상태 머신 (백엔드 models/analysis_job.py 의 JobStatus 와 1:1).
 *
 * QUEUED → RUNNING → SUCCEEDED
 *                  ↘ FAILED
 *                  ↘ CANCELLED
 */
export type AnalysisStatus = 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'

/** 진행 화면에 "무엇을 하고 있는지" 보여주기 위한 단계. status 와 달리 참고용이다. */
export type AnalysisStage =
  | 'UPLOADING'
  | 'OCR'
  | 'ANALYZING'
  | 'RAG'
  | 'LLM'
  | 'SAVING'
  | 'COMPLETED'

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'

const TERMINAL: readonly AnalysisStatus[] = ['SUCCEEDED', 'FAILED', 'CANCELLED']

/** 더 이상 변하지 않는 상태. **폴링을 멈출 시점을 여기서만 판단한다.** */
export function isTerminal(status: AnalysisStatus): boolean {
  return TERMINAL.includes(status)
}

/** 서류 한 장의 OCR·마스킹 결과. 마스킹 PDF 는 보관하지 않으므로 여기 없다. */
export interface AnalysisDocument {
  filename: string
  sanitized_text: string
  redaction_counts: Record<string, number>
  redaction_scope: string[]
  mask_count: number
  coarse_mask_count: number
  review_required: boolean
}

export interface AnalysisResult {
  sanitized_text: string
  redaction_counts: Record<string, number>
  redaction_scope: string[]
  mask_count: number
  coarse_mask_count: number
  review_required: boolean
  documents: AnalysisDocument[]
  analysis: ContractAnalysis
}

/** POST /analyses 의 202 응답 — 접수됐다는 사실과 추적용 id 만. */
export interface AnalysisJob {
  id: string
  status: AnalysisStatus
  created_at: string
}

export interface AnalysisJobSummary {
  id: string
  status: AnalysisStatus
  stage: AnalysisStage | null
  progress: number
  file_names: string[]
  title: string | null
  risk_level: RiskLevel | null
  created_at: string
  finished_at: string | null
}

export interface AnalysisError {
  code: string | null
  /** 그대로 사용자에게 보이는 한국어 문구다. */
  message: string
}

export interface AnalysisJobDetail extends AnalysisJobSummary {
  summary: string | null
  attempt_count: number
  /** SUCCEEDED 일 때만 채워진다. */
  result: AnalysisResult | null
  error: AnalysisError | null
}
