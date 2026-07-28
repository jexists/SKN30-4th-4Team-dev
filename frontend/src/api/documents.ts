import type { DocumentAnalysisResult } from '../types/document'
import { apiPostForm } from './client'

export function analyzeContract(file: File): Promise<DocumentAnalysisResult> {
  const form = new FormData()
  form.append('file', file)
  return apiPostForm<DocumentAnalysisResult>('/api/v1/documents/analyze', form)
}
