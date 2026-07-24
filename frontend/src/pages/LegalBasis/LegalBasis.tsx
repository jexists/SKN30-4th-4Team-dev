import { LegalBlockView } from '../../components/LegalDoc/blocks'
import { LEGAL_BASIS } from '../../content/legalBasis'
import styles from './LegalBasis.module.scss'

export function LegalBasis() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{LEGAL_BASIS.title}</h1>
        <p className={styles.intro}>{LEGAL_BASIS.intro}</p>

        {LEGAL_BASIS.chapters.map((chapter) => (
          <section key={chapter.title} className={styles.chapter}>
            <h2 className={styles.chapterTitle}>{chapter.title}</h2>
            {chapter.articles.map((article) => (
              <article key={article.heading} className={styles.article}>
                <h3 className={styles.articleHeading}>{article.heading}</h3>
                {article.blocks.map((block, i) => (
                  <LegalBlockView key={i} block={block} />
                ))}
              </article>
            ))}
          </section>
        ))}

        <section className={styles.chapter}>
          <h2 className={styles.chapterTitle}>{LEGAL_BASIS.appendix.title}</h2>
          <ol className={styles.appendixList}>
            {LEGAL_BASIS.appendix.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  )
}
