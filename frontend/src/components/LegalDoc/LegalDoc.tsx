import type { LegalDoc } from '../../content/legal'
import styles from './LegalDoc.module.scss'

/** 약관·방침 문서를 화면에 렌더한다. 모달과 페이지가 공유해 같은 내용을 보여준다. */
export function LegalDocView({ doc }: { doc: LegalDoc }) {
  return (
    <article className={styles.doc}>
      <p className={styles.effective}>시행일: {doc.effectiveDate}</p>
      {doc.intro && <p className={styles.intro}>{doc.intro}</p>}
      {doc.sections.map((section) => (
        <section key={section.heading} className={styles.section}>
          <h3 className={styles.heading}>{section.heading}</h3>
          {section.body.map((para, i) => (
            <p key={i} className={styles.para}>
              {para}
            </p>
          ))}
        </section>
      ))}
    </article>
  )
}

/** 라우트로 직접 접근했을 때 보여줄 전체 페이지. 모달과 같은 본문을 재사용한다. */
export function LegalPage({ doc }: { doc: LegalDoc }) {
  return (
    <div className={styles.page}>
      <div className={styles.pageCard}>
        <h1 className={styles.pageTitle}>{doc.title}</h1>
        <LegalDocView doc={doc} />
      </div>
    </div>
  )
}
