export type Role = 'user' | 'assistant'

export interface Message {
  id: string
  role: Role
  content: string
  /** 에러 버블(생성 실패)인지. */
  error?: boolean
  /** 타이핑 스트리밍 중인지(AI 응답이 점진 표시 중). */
  streaming?: boolean
}

/**
 * 첨부한 계약서의 진행 상태.
 *
 * PREPARING  업로드·접수 중 (아직 작업 id 가 없다)
 * PROCESSING OCR·분석 진행 중 — 아직 질문에 계약서 맥락을 쓸 수 없다
 * READY      방에 첨부 완료 — 이후 모든 질문에 계약서가 함께 들어간다
 * FAILED     접수·분석 실패. 사유를 message 로 보여주고 다시 첨부할 수 있게 둔다
 */
export type AttachmentState = 'PREPARING' | 'PROCESSING' | 'READY' | 'FAILED'

export interface Attachment {
  fileName: string
  state: AttachmentState
  /** 실패했을 때 사용자에게 그대로 보이는 사유. */
  message?: string
}
