import { Shield } from '../../components/icons'
import { BRAND } from '../../config/env'
import styles from './Chat.module.scss'

interface Props {
  /** 예시 질문 클릭 → 즉시 전송. */
  onExample: (text: string) => void
}

const EXAMPLES = [
  '전세 계약이 끝났는데 보증금을 안 돌려줘요. 어떻게 해야 하나요?',
  '집주인이 갑자기 월세를 크게 올려달라고 합니다. 거절할 수 있나요?',
  '계약 갱신을 요구했는데 집주인이 실거주를 이유로 거절해요.',
  '이사 나갈 때 집주인이 도배·장판 비용을 청구합니다. 내야 하나요?',
]

/**
 * 첫 진입(대화 없음) 화면. 예시 질문을 누르면 바로 상담이 시작된다.
 */
export function EmptyState({ onExample }: Props) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Shield />
      </div>
      <h1 className={styles.emptyTitle}>무엇을 도와드릴까요?</h1>
      <p className={styles.emptySubtitle}>
        전·월세 계약과 임대차 분쟁에 대해 물어보세요.<br />{BRAND.name}가 관련 법령·판례를 근거로 답해드려요.
      </p>
      <div className={styles.emptyCards}>
        {EXAMPLES.map((q) => (
          <button key={q} type="button" className={styles.emptyCard} onClick={() => onExample(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
