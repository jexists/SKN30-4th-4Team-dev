import styles from './ErrorState.module.scss'

type Props = {
  /**
   * 실패한 영역이 무엇인지 한 줄로. 원인 설명은 보통 공통 오류 모달이 이미 했다.
   * 모달을 끈 호출부(`{ silent: true }`)라면 서버가 준 문구를 그대로 넘긴다.
   */
  message?: string
  /** 주면 "다시 시도" 버튼이 붙는다. 다시 눌러도 결과가 같은 실패(404 등)엔 주지 않는다. */
  onRetry?: () => void
  /**
   * 재시도로는 풀 수 없는 실패에서 빠져나갈 길(예: "새 대화 시작").
   * 재시도 버튼이 없는 화면이 막다른 길이 되지 않게 한다.
   */
  action?: { label: string; onClick: () => void }
  /**
   * - `card`(기본) — 목록 안처럼 좁은 자리에 놓일 때. 테두리로 영역을 구분한다.
   * - `plain` — 화면 한가운데를 통째로 채울 때. 테두리·배경이 허공에 뜬 띠처럼 보인다.
   */
  variant?: 'card' | 'plain'
}

/**
 * 데이터를 못 불러온 영역에 놓는 공통 오류 자리표시.
 *
 * **API 실패를 Empty State 로 보여주지 않기 위해 존재한다** — "데이터가 없습니다" 로
 * 위장하면 사용자가 원인을 오해한다. 여기서는 실패한 자리를 표시하고 거기서 나갈
 * 방법(재시도 또는 대체 행동)을 준다.
 */
export function ErrorState({
  message = '불러오지 못했습니다.',
  onRetry,
  action,
  variant = 'card',
}: Props) {
  return (
    <div
      className={variant === 'plain' ? `${styles.root} ${styles.plain}` : styles.root}
      role="alert"
    >
      <p className={styles.message}>{message}</p>
      {(onRetry || action) && (
        <div className={styles.actions}>
          {onRetry && (
            <button type="button" className={styles.action} onClick={onRetry}>
              다시 시도
            </button>
          )}
          {action && (
            <button type="button" className={styles.action} onClick={action.onClick}>
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
