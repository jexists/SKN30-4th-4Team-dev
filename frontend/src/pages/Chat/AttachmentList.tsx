import { Close, FileLines, Photo } from '../../components/icons'
import styles from './Chat.module.scss'
import type { AttachmentKind } from './types'

export interface AttachmentItem {
  /** React key 이자 제거 대상 식별자. */
  key: string
  name: string
  kind: AttachmentKind
  /** 이미지일 때만, 그리고 이번 세션에서 고른 파일일 때만 있다. */
  previewUrl?: string
}

interface Props {
  items: AttachmentItem[]
  /**
   * composer  입력창 위 프리뷰 — 밝은 배경, 각 칩에 ✕
   * message   사용자 말풍선 안 — 어두운(navy) 배경, 제거 불가
   */
  variant: 'composer' | 'message'
  /** composer 에서만 넘긴다. */
  onRemove?: (key: string) => void
}

/**
 * 첨부파일 목록. 입력창 프리뷰와 말풍선이 같은 컴포넌트를 쓴다 — 보내기 전과 보낸 뒤의
 * 파일이 다르게 생기면 "같은 것" 으로 읽히지 않는다.
 *
 * 이미지는 썸네일, 그 외는 아이콘 + 파일명. 새로고침 뒤에는 원본이 서버에 없으므로
 * previewUrl 이 비고 이미지도 아이콘으로 떨어진다(의도된 폴백).
 */
export function AttachmentList({ items, variant, onRemove }: Props) {
  if (items.length === 0) return null

  const isComposer = variant === 'composer'

  return (
    <ul className={`${styles.attachments} ${isComposer ? '' : styles.attachmentsOnDark}`}>
      {items.map((item) => (
        <li key={item.key} className={styles.attachment}>
          {item.previewUrl ? (
            // 파일명은 아래 텍스트가 이미 말하므로 장식으로 둔다.
            <img className={styles.attachmentThumb} src={item.previewUrl} alt="" />
          ) : (
            <span className={styles.attachmentIcon}>
              {item.kind === 'image' ? <Photo /> : <FileLines />}
            </span>
          )}
          {/* title 로 전체 이름을 남긴다 — 목록에서는 긴 이름이 말줄임된다. */}
          <span className={styles.attachmentName} title={item.name}>
            {item.name}
          </span>
          {isComposer && onRemove && (
            <button
              type="button"
              className={styles.attachmentRemove}
              aria-label={`${item.name} 제거`}
              onClick={() => onRemove(item.key)}
            >
              <Close />
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}
