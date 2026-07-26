import { ChevronDown } from '../../components/icons'
import { TOPICS } from './topics'
import styles from './Chat.module.scss'

type Props = {
  /** 고른 주제(null = 기본 화면). */
  topicId: string | null
  /** 칩 목록이 펼쳐져 있는지. 접으면 그만큼 대화 목록이 길어진다. */
  open: boolean
  onToggle: () => void
  onSelect: (id: string) => void
}

/** 사이드바·드로어 하단의 추천 주제 칩. 첫 화면(Hero)의 내용만 바꾼다. */
export function ChatSuggestTopics({ topicId, open, onToggle, onSelect }: Props) {
  return (
    <div className={styles.suggest}>
      <button
        type="button"
        className={styles.suggestToggle}
        aria-expanded={open}
        aria-controls="chat-suggest-chips"
        onClick={onToggle}
      >
        <h3 className={styles.suggestTitle}>추천 주제</h3>
        <ChevronDown
          className={`${styles.suggestChevron} ${open ? styles.suggestChevronOpen : ''}`}
        />
      </button>
      {open && (
        <div id="chat-suggest-chips" className={styles.chips}>
          {TOPICS.map((topic) => (
            <button
              key={topic.id}
              type="button"
              className={`${styles.chip} ${topicId === topic.id ? styles.chipActive : ''}`}
              aria-pressed={topicId === topic.id}
              onClick={() => onSelect(topic.id)}
            >
              {topic.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
