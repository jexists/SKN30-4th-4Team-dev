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

// 동기 분석 응답(DocumentAnalysisResult)은 제거됐다. 분석은 이제 작업 큐를 거치므로
// 결과 타입은 types/analysis.ts 의 AnalysisResult 를 쓴다(마스킹 PDF 는 보관하지 않는다).
