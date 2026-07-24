import { renderInline } from './renderInline'
import styles from './blocks.module.scss'

/** 약관·방침류 문서가 공유하는 문단 단위. 표·인용구는 여러 문서에서 반복되는 패턴이라 공용화한다. */
export type LegalBlock =
  | { kind: 'p'; text: string; indent?: boolean }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'quote'; lines: string[] }

export function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.kind === 'table') {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {block.headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (block.kind === 'quote') {
    return (
      <blockquote className={styles.quote}>
        {block.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </blockquote>
    )
  }

  return (
    <p className={block.indent ? `${styles.para} ${styles.paraIndent}` : styles.para}>
      {renderInline(block.text)}
    </p>
  )
}
