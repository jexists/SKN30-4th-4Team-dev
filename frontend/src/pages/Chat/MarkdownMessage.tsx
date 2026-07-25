import { isValidElement, type ReactNode } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { CodeBlock } from './CodeBlock'
import styles from './MarkdownMessage.module.scss'

/**
 * AI 답변을 마크다운으로 렌더한다(heading/list/table(gfm)/quote/code).
 * - 코드블록(펜스)은 pre 를 가로채 CodeBlock(복사 버튼)으로 — 한 줄짜리 블록도 인라인으로
 *   오분류되지 않게 한다. 인라인 코드는 배지 스타일.
 * - 이미지는 lazy 로딩, 링크는 새 탭.
 * react-markdown 은 기본적으로 원본 HTML 을 실행하지 않으므로(rehype-raw 미사용) XSS 안전.
 */

/** React 노드 트리에서 순수 텍스트만 뽑아낸다(코드블록 원문 추출용). */
function nodeText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode }).children)
  return ''
}

const components: Components = {
  pre: ({ children }) => <CodeBlock code={nodeText(children).replace(/\n$/, '')} />,
  code: ({ children }) => <code className={styles.inlineCode}>{children}</code>,
  img: ({ src, alt }) => (
    <img src={typeof src === 'string' ? src : undefined} alt={alt ?? ''} loading="lazy" />
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
}

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className={styles.md}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  )
}
