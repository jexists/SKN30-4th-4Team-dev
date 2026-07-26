import { ChevronRight, Edit } from '../../components/icons'
import styles from './Chat.module.scss'

type Props = {
  /** 대화기록 드로어를 연다. */
  onOpenHistory: () => void
  onNewChat: () => void
  /** 아래로 스크롤 중 — 대화를 읽는 동안 비켜 준다. */
  hidden: boolean
}

/**
 * 좁은 화면 챗 화면의 떠 있는 액션 — 좌측 대화기록, 우측 새 채팅.
 *
 * 자리를 예약하지 않고 대화 위에 겹쳐 뜬다. 그래서 읽는 데 방해가 되지 않도록
 * 아래로 스크롤하면 사라지고 위로 올리면 돌아온다(useHideOnScrollDown).
 * 버튼 사이의 빈 공간이 대화 클릭을 막지 않게 컨테이너는 pointer-events 를 받지 않는다.
 */
export function ChatMobileActions({ onOpenHistory, onNewChat, hidden }: Props) {
  return (
    <div
      className={`${styles.mobileActions} ${hidden ? styles.mobileActionsHidden : ''}`}
      // 감춰진 동안에는 탭 순서에서도 빠진다.
      aria-hidden={hidden}
      inert={hidden}
    >
      <button type="button" className={styles.floatBtn} onClick={onOpenHistory}>
        대화기록
        <ChevronRight className={styles.floatBtnChevron} />
      </button>

      <button type="button" className={styles.floatBtn} onClick={onNewChat}>
        <Edit className={styles.floatBtnIcon} />새 채팅
      </button>
    </div>
  )
}
