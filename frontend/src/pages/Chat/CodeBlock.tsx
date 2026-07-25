import { useState } from 'react'

import { Check } from '../../components/icons'
import styles from './CodeBlock.module.scss'

/** 마크다운 코드블록 — 우상단 복사 버튼 제공. */
export function CodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      /* 클립보드 미지원·권한 거부 — 조용히 무시 */
    }
  }

  return (
    <div className={styles.wrap}>
      <button type="button" className={styles.copy} onClick={copy} aria-label="코드 복사">
        {copied ? (
          <>
            <Check className={styles.icon} /> 복사됨
          </>
        ) : (
          '복사'
        )}
      </button>
      <pre className={styles.pre}>
        <code className={className}>{code}</code>
      </pre>
    </div>
  )
}
