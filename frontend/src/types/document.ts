export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

/** 전세 / 월세. 백엔드가 계약서 문구를 근거로 판별한다(반전세는 월세로 본다). */
export type ContractType = '전세' | '월세'

export interface ContractTerms {
  /**
   * 계약 유형·소재지는 나중에 추가된 필드다. 결과 전문이 JSONB 한 덩어리로 저장되므로
   * **예전 분석 레코드에는 이 키가 없어 항상 null 이 온다.** 계약 유형은
   * `pages/RiskReport/contractType.ts` 의 폴백이 월세 원문으로 메우고, 주소는 메울 수 없다.
   */
  contract_type: ContractType | null
  deposit: string | null
  monthly_rent: string | null
  contract_start: string | null
  contract_end: string | null
  address: string | null
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
