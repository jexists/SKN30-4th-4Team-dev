import { apiPostForm } from './client'

/** 계약서에서 추출한 핵심 조건 (백엔드 ContractTerms). 값이 없으면 null. */
export interface ContractTerms {
  deposit: string | null
  monthly_rent: string | null
  contract_start: string | null
  contract_end: string | null
  property_type: string | null
  special_terms: string[]
}

export interface ContractRiskIssue {
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  title: string
  clause: string | null
  reason: string
  recommendation: string
}

export interface ContractLlmAnalysis {
  summary: string
  terms: ContractTerms
  risks: ContractRiskIssue[]
  missing_information: string[]
}

/** POST /documents/analyze 응답 (백엔드 DocumentAnalysisOut). */
export interface DocumentAnalysis {
  /** 개인정보가 치환된 계약서 전문 — 후속 질문 맥락(document_context)으로 사용한다. */
  sanitized_text: string
  redaction_counts: Record<string, number>
  redaction_scope: string[]
  mask_count: number
  coarse_mask_count: number
  review_required: boolean
  masked_pdf_media_type: string
  masked_pdf_base64: string
  analysis: ContractLlmAnalysis
}

/**
 * 계약서 파일을 로컬 OCR worker 로 익명화한 뒤 안전 텍스트만 LLM 분석해 돌려받는다.
 *
 * OCR + LLM 이라 수 초~수십 초 걸릴 수 있다. 성공 토스트·실패 모달은 공통 client 가 처리한다.
 */
export function analyzeContract(file: File): Promise<DocumentAnalysis> {
  const form = new FormData()
  form.append('file', file)
  return apiPostForm<DocumentAnalysis>('/api/v1/documents/analyze', form)
}