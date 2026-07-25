/**
 * 표준 응답 봉투의 실패(`success: false`)를 나타내는 예외.
 *
 * client.ts 와 apiErrorHandler.ts 가 모두 참조하므로 순환 참조를 피해 여기 따로 둔다.
 * (client.ts 가 다시 export 하므로 화면 코드는 예전처럼 `from '../../api/client'` 로 써도 된다.)
 */
export class ApiError extends Error {
  /** 오류 모달 제목. 서버 error.title 을 그대로 쓴다. */
  title: string
  /** HTTP 상태 코드. 분기(401 등)는 title 이 아니라 이 값으로 한다. */
  code: number

  constructor(title: string, message: string, code: number) {
    super(message)
    this.title = title
    this.code = code
  }
}
