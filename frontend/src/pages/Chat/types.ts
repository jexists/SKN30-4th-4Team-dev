export type Role = 'user' | 'assistant'

/** 첨부파일의 종류 — 아이콘과 썸네일 여부를 가른다. 백엔드 MessageAttachment.kind 와 같다. */
export type AttachmentKind = 'image' | 'pdf' | 'file'

/**
 * 메시지와 함께 보낸 첨부파일 하나.
 *
 * 서버에는 **이름과 종류만** 저장된다 — 원본은 분석이 끝나면 지워지므로 다시 내려받을 수
 * 없다. previewUrl 은 방금 고른 파일의 objectURL 이라 이 세션에서만 살아 있고, 새로고침 뒤엔
 * 없다(그때는 썸네일 대신 아이콘으로 그린다). 그래서 서버로 보낼 때는 빼고 보낸다.
 */
export interface MessageAttachment {
  name: string
  kind: AttachmentKind
  previewUrl?: string
}

export interface Message {
  id: string
  role: Role
  content: string
  /**
   * DB 에 저장된 이 메시지의 id. 로컬 id(`m…`)와 달리 서버가 준 값이라, 재시도가 성공했을 때
   * **같은 행을 갈아끼울** 수 있다. 저장이 끝나기 전이거나 비영속 대화면 없다.
   *
   * 기록에서 되살아난 메시지는 id 자체가 서버 id 이므로 여기에도 같은 값이 들어간다.
   */
  serverId?: string
  /** 이 메시지와 함께 보낸 첨부파일. 사용자 말풍선 안에 그린다. */
  attachments?: MessageAttachment[]
  /** 에러 버블(생성 실패)인지. */
  error?: boolean
  /**
   * 첨부를 읽지 못한 채 답한 경우의 사유(예: "계약서 처리 서버가 응답하지 않습니다.").
   * 답변 말풍선 **위**에 경고 줄로 그린다 — 답변 본문에 섞으면 마크다운에 묻히고, 서버가 준
   * 구체적인 사유(형식·용량·개인정보 잔존)가 "생성 실패" 로 뭉개진다.
   *
   * 화면에만 있고 DB 에 저장하지 않는다. 새로고침 뒤에도 남아야 하는 인정 문구는 답변 본문
   * 첫 문장이 담당한다(서버 attachment_failed 플래그).
   */
  degradedNotice?: string
  /** 타이핑 스트리밍 중인지(AI 응답이 점진 표시 중). */
  streaming?: boolean
  /**
   * 잠시 보여주는 진행 버블(계약서를 읽는 중)인지. 화면에만 있고 DB 에 저장하지 않으며,
   * 결과가 나오면 답변으로 교체된다.
   */
  pending?: boolean
}

/**
 * 아직 보내지 않은 첨부파일. 사용자가 고른 File 을 그대로 들고 있다가 전송할 때 업로드한다.
 *
 * 예전에는 파일을 고르는 즉시 분석을 시작했지만, 그러면 ✕ 로 뺄 수 있는 시점이 없었다
 * (이미 OCR 이 돌고 있다). 지금은 전송 전까지는 순수하게 목록일 뿐이다.
 */
export interface PendingFile {
  /** mergeFiles 의 fileKey — React key 이자 제거 대상 식별자. */
  key: string
  file: File
  kind: AttachmentKind
  /** 이미지일 때만. 컴포넌트가 언마운트될 때 revoke 한다. */
  previewUrl?: string
}

/** 이 대화가 지금 참고 중인 계약서(방 단위). 새로 첨부하면 통째로 교체된다. */
export interface RoomAttachment {
  fileNames: string[]
}

/**
 * 재시도할 수 있는 **실패한 턴 하나**. 방이 아니라 그 턴에 매인다.
 *
 * 예전에는 재시도 질문이 전역 `lastQuestion`, 재시도 파일이 방 단위 목록이었다. 둘이 따로 놀아서
 * "계약서 A 첨부 실패 → 재시도하지 않고 질문 B 전송 → 실패 말풍선의 버튼 클릭" 이면 **계약서 A 와
 * 질문 B 가 함께** 나갔다 — 엉뚱한 계약서를 근거로 한 답이다. 질문·파일·대상 말풍선을 한 덩어리로
 * 묶고, 새 질문이 들어오면 이 덩어리째 버린다.
 *
 * 한 시점에 살아 있는 것은 **가장 최근 실패 turn 하나**뿐이다. 여러 개를 들고 있으면 어느 파일이
 * 아직 메모리에 남아 있는지 추적할 수 없고, 과거 말풍선의 버튼이 지금 맥락과 어긋난 요청을 만든다.
 */
export interface RetryContext {
  /** 이 턴이 속한 방(비영속 대화는 null). 다른 방으로 옮기면 폐기 대상이다. */
  roomId: string | null
  /** 실패했던 **정확한** 질문. 첨부만 보낸 턴이면 기본 문구가 들어 있다. */
  question: string
  /** 사용자가 직접 쓴 글이 있었는지. 없으면 첨부 실패 시 답변을 만들지 않는다(지어낸 답이 된다). */
  typed: boolean
  /** 다시 올릴 파일. 이미 방에 붙은 계약서는 서버가 들고 있으므로 비어 있다. */
  files: PendingFile[]
  /** 이 재시도가 갈아끼울 화면 위 assistant 말풍선. 버튼은 이 말풍선에만 붙는다. */
  localMessageId: string
  /** 그 말풍선이 DB 에도 저장돼 있으면 그 행 id — 재시도 성공 시 PUT 으로 교체한다. */
  serverMessageId: string | null
}
