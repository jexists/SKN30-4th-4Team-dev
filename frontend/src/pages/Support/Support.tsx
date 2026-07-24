import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Chat, ChevronDown, Doc, Lock, Mail, Search, Wallet } from '../../components/icons'
import styles from './Support.module.scss'

type Faq = {
  question: string
  answer: string
  hot?: boolean
}

type Category = {
  id: string
  label: string
  icon: typeof Doc
  title: string
  totalLabel: string
  faqs: Faq[]
}

const CATEGORIES: Category[] = [
  {
    id: 'diagnosis',
    label: '계약 진단',
    icon: Doc,
    title: '계약 진단 (Contract Diagnosis)',
    totalLabel: '총 12개의 도움말',
    faqs: [
      {
        hot: true,
        question: '계약서 사진 촬영 시 주의사항이 있나요?',
        answer:
          'HomeShield AI는 OCR(광학 문자 인식) 기술을 사용합니다. 정확한 분석을 위해 다음 사항을 지켜주세요.\n\n1. 문서의 네 모서리가 모두 화면에 들어오게 촬영하세요.\n2. 그림자가 지지 않는 밝은 곳에서 촬영하세요.\n3. 흔들림 없이 글자가 선명하게 보여야 합니다.\n4. 개인정보 보호를 위해 주민등록번호 뒷자리는 가리고 촬영하시는 것이 좋습니다.',
      },
      {
        question: "분석 결과에서 '위험' 판정이 나왔습니다. 어떻게 해야 하나요?",
        answer:
          "'위험' 판정은 해당 계약 조항이 임차인에게 일방적으로 불리하거나, 전세 사기의 징후가 있을 때 발생합니다. 보고서에 기재된 '권고 사항'을 반드시 확인하시고, 공인중개사에게 해당 조항의 수정을 요청하거나 HomeShield 연계 법률 상담 서비스를 이용하시길 권장합니다.",
      },
      {
        question: '오래된 종이 계약서도 분석이 가능한가요?',
        answer:
          "네, 가능합니다. 다만 글씨가 너무 흐릿하거나 훼손된 경우에는 정확도가 떨어질 수 있습니다. 이 경우 수기로 내용을 직접 입력하는 '수동 진단' 모드를 활용하실 수 있습니다.",
      },
    ],
  },
  {
    id: 'chatbot',
    label: 'AI 챗봇',
    icon: Chat,
    title: 'AI 챗봇 (AI Chatbot)',
    totalLabel: '총 8개의 도움말',
    faqs: [
      {
        question: 'AI 챗봇의 답변은 법적 효력이 있나요?',
        answer:
          'AI 챗봇은 관련 법령과 판례를 근거로 안내를 제공하지만, 공식적인 법률 자문을 대신하지 않습니다. 중요한 의사 결정 전에는 반드시 전문가 상담을 함께 받으시길 권장합니다.',
      },
      {
        question: '상담 내용은 저장되나요?',
        answer:
          '로그인한 계정에 한해 상담 기록이 저장되며, 마이페이지의 "진행 중인 AI 상담"에서 이어서 확인하실 수 있습니다.',
      },
    ],
  },
  {
    id: 'billing',
    label: '결제 및 계정',
    icon: Wallet,
    title: '결제 및 계정 (Billing & Account)',
    totalLabel: '총 6개의 도움말',
    faqs: [
      {
        question: '프리미엄 회원은 어떤 혜택이 있나요?',
        answer:
          '무제한 계약서 진단, 우선 순위 AI 상담, PDF 리포트 다운로드 등의 기능을 제공합니다. 자세한 내용은 마이페이지에서 확인하실 수 있습니다.',
      },
      {
        question: '계정을 삭제하고 싶어요.',
        answer:
          '마이페이지 > 계정 설정에서 탈퇴를 신청하실 수 있습니다. 탈퇴 시 진단 내역과 상담 기록은 즉시 삭제되며 복구되지 않습니다.',
      },
    ],
  },
  {
    id: 'security',
    label: '보안 및 정책',
    icon: Lock,
    title: '보안 및 정책 (Security & Policy)',
    totalLabel: '총 5개의 도움말',
    faqs: [
      {
        question: '업로드한 계약서 이미지는 안전하게 보관되나요?',
        answer:
          '업로드된 이미지와 분석 결과는 암호화되어 저장되며, 진단 목적 외에는 사용되지 않습니다. 자세한 내용은 개인정보처리방침을 참고해 주세요.',
      },
      {
        question: '개인정보는 어떻게 처리되나요?',
        answer:
          '수집된 개인정보는 서비스 제공 목적으로만 사용되며, 관련 법령에 따라 안전하게 관리됩니다.',
      },
    ],
  },
]

const KEYWORDS = ['#전세가율', '#특약사항', '#확정일자', '#보증보험']

export function Support() {
  const [activeId, setActiveId] = useState(CATEGORIES[0].id)
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const active = CATEGORIES.find((c) => c.id === activeId) ?? CATEGORIES[0]

  function selectCategory(id: string) {
    setActiveId(id)
    setOpenIndex(0)
  }

  return (
    <div className={styles.page}>
      {/* 히어로 */}
      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <h1 className={styles.heroTitle}>무엇을 도와드릴까요?</h1>
          <p className={styles.heroDesc}>
            HomeShield의 AI 기술과 전문 법률 가이드가 당신의 안전한 임대차 계약을 지원합니다.
          </p>
          <div className={styles.searchWrap}>
            <Search className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              type="text"
              placeholder="궁금한 내용을 입력하세요 (예: 전세사기 예방법, 계약서 진단 방법)"
            />
          </div>
          <div className={styles.keywords}>
            <span className={styles.keywordsLabel}>인기 키워드:</span>
            {KEYWORDS.map((k) => (
              <span key={k} className={styles.keyword}>
                {k}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className={styles.body}>
        <div className={styles.bodyInner}>
          <aside className={styles.sidebar}>
            <h2 className={styles.sidebarTitle}>도움말 카테고리</h2>
            <nav className={styles.sidebarNav}>
              {CATEGORIES.map((c) => {
                const Icon = c.icon
                const isActive = c.id === activeId
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem}
                    onClick={() => selectCategory(c.id)}
                  >
                    <Icon className={styles.navItemIcon} />
                    {c.label}
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className={styles.faqCol}>
            <div className={styles.faqHead}>
              <h3 className={styles.faqTitle}>{active.title}</h3>
              <span className={styles.faqCount}>{active.totalLabel}</span>
            </div>
            <div className={styles.faqList}>
              {active.faqs.map((faq, i) => {
                const isOpen = openIndex === i
                return (
                  <div key={faq.question} className={styles.faqItem}>
                    <button
                      type="button"
                      className={styles.faqQuestion}
                      onClick={() => setOpenIndex(isOpen ? null : i)}
                      aria-expanded={isOpen}
                    >
                      <span className={styles.faqQuestionLeft}>
                        {faq.hot && <span className={styles.hotTag}>HOT</span>}
                        <span className={styles.faqQuestionText}>{faq.question}</span>
                      </span>
                      <ChevronDown
                        className={isOpen ? `${styles.faqArrow} ${styles.faqArrowOpen}` : styles.faqArrow}
                      />
                    </button>
                    {isOpen && (
                      <div className={styles.faqAnswer}>
                        {faq.answer.split('\n').map((line, j) => (
                          <p key={j}>{line}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* 문의 CTA */}
            <div className={styles.contactCta}>
              <div>
                <h4 className={styles.contactTitle}>원하는 답변을 찾지 못하셨나요?</h4>
                <p className={styles.contactDesc}>
                  HomeShield 고객센터는 24시간 열려있습니다. 전문 상담사에게 직접 물어보세요.
                </p>
              </div>
              <div className={styles.contactActions}>
                <Link to="/chat" className={styles.btnPrimary}>
                  <Chat /> 1:1 상담 시작하기
                </Link>
                <button type="button" className={styles.btnOutline}>
                  <Mail /> 이메일 문의
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
