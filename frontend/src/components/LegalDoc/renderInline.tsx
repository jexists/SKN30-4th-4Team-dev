import { Fragment } from 'react'

/** "**굵게**" 표기만 지원하는 최소 인라인 렌더러. 문서 전반에서 반복되는 강조 라벨용. */
export function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
