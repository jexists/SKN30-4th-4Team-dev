export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ContractTerms {
  deposit: string | null
  monthly_rent: string | null
  contract_start: string | null
  contract_end: string | null
  property_type: string | null
  special_terms: string[]
}

export interface ContractRiskIssue {
  severity: RiskSeverity
  title: string
  clause: string | null
  reason: string
  recommendation: string
}

export interface ContractAnalysis {
  summary: string
  terms: ContractTerms
  risks: ContractRiskIssue[]
  missing_information: string[]
}

export interface DocumentAnalysisResult {
  sanitized_text: string
  redaction_counts: Record<string, number>
  redaction_scope: string[]
  mask_count: number
  coarse_mask_count: number
  review_required: boolean
  masked_pdf_media_type: string
  masked_pdf_base64: string
  analysis: ContractAnalysis
}
