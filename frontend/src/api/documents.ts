import type { DocumentAnalysisResult } from '../types/document'
import { apiPostForm } from './client'

export function analyzeDocuments(files: File[]): Promise<DocumentAnalysisResult> {
  const form = new FormData()
  for (const file of files) {
    // FastAPI의 list[UploadFile] 계약에 맞춰 같은 필드 이름을 반복한다.
    form.append('file', file)
  }
  return apiPostForm<DocumentAnalysisResult>('/api/v1/documents/analyze', form)
}
