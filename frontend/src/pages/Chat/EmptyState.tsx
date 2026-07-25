import { Shield } from '../../components/icons'
import type { Topic } from './topics'
import styles from './Chat.module.scss'

interface Props {
  /** 사이드바에서 고른 추천 주제(없으면 기본 화면). 제목·설명·질문이 통째로 바뀐다. */
  topic: Topic
  /** 추천 질문 클릭 → 즉시 전송(새 채팅은 이때 만들어진다). */
  onExample: (text: string) => void
}

/**
 * 첫 진입(대화 없음) 화면. 추천 질문을 누르면 바로 상담이 시작된다.
 *
 * 주제가 바뀌면 key 로 내용을 갈아끼워 페이드가 매번 다시 재생되게 한다 —
 * 페이지 이동 없이 같은 자리에서 내용만 바뀐다는 걸 보여주는 신호다.
 */
export function EmptyState({ topic, onExample }: Props) {
  return (
    <div className={styles.empty}>
      <div key={topic.id} className={styles.emptyHero}>
        <div className={styles.emptyIcon}>
          <Shield />
        </div>
        {/* 사이드바('대화 기록')가 이미 h2 다 — 본문도 같은 단계로 맞춰 순서를 지킨다. */}
        <h2 className={styles.emptyTitle}>{topic.title}</h2>
        <p className={styles.emptySubtitle}>{topic.description}</p>
        <div className={styles.emptyCards}>
          {topic.questions.map((q) => (
            <button key={q} type="button" className={styles.emptyCard} onClick={() => onExample(q)}>
              {q}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
