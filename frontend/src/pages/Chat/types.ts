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
