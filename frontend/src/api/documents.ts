import { apiPostForm } from './client'

export type FieldStatus = 'extracted' | 'not_stated' | 'unreadable'
export type ExtractionMethod = 'text' | 'ocr' | 'vision'

export type OcrField = {
  value: unknown
  raw: string | null
  status: FieldStatus
  confidence: number
  page: number | null
  bbox: [number, number, number, number] | null
  method: ExtractionMethod
}

export type OcrPage = {
  page: number
  width: number
  height: number
  text: string
  method: ExtractionMethod
}

export type OcrDocument = {
  doc_type: 'lease_contract' | 'special_terms' | 'disclosure' | 'mutual_aid'
  source_file: string
  page_count: number
  parsed_at: string
  parser_version: string
  overall_confidence: number
  warnings: string[]
  fields: Record<string, unknown>
}

export type OcrExtractionResponse = {
  mode: 'contract_bundle' | 'registry'
  source_file: string
  page_count: number
  mask_count: number
  coarse_mask_count: number
  review_required: boolean
  ocr_pages: OcrPage[]
  documents: OcrDocument[]
  missing_doc_types: string[]
  warnings: string[]
}

export type FileAnalysisResult = {
  status: 'completed' | 'failed'
  data: OcrExtractionResponse | null
  error: string | null
}

export type AnalyzeDocumentsResponse = {
  contract: FileAnalysisResult
  registry: FileAnalysisResult | null
  engine_input: {
    unknowns: string[]
    [key: string]: unknown
  }
}

export function analyzeDocuments(
  contractFile: File,
  registryFile?: File,
): Promise<AnalyzeDocumentsResponse> {
  const form = new FormData()
  form.append('contract_file', contractFile)
  if (registryFile) form.append('registry_file', registryFile)
  return apiPostForm('/api/v1/documents/analyze', form)
}
