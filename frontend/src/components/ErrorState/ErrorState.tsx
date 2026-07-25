import styles from './ErrorState.module.scss'

type Props = {
  /** 실패한 영역이 무엇인지 한 줄로. 원인 설명은 공통 오류 모달이 이미 했다. */
  message?: string
  /** 주면 "다시 시도" 버튼이 붙는다. 다시 눌러도 결과가 같은 실패(404 등)엔 주지 않는다. */
  onRetry?: () => void
}

/**
 * 데이터를 못 불러온 영역에 놓는 공통 오류 자리표시.
 *
 * **API 실패를 Empty State 로 보여주지 않기 위해 존재한다** — "데이터가 없습니다" 로
 * 위장하면 사용자가 원인을 오해한다. 원인 안내는 공통 오류 모달이 맡고, 여기서는
 * 실패한 자리를 표시하고 다시 시도할 방법만 준다.
 */
export function ErrorState({ message = '불러오지 못했습니다.', onRetry }: Props) {
  return (
    <div className={styles.root} role="alert">
      <p className={styles.message}>{message}</p>
      {onRetry && (
        <button type="button" className={styles.action} onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  )
}
