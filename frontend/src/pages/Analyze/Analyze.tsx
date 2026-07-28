import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { analyzeContract } from '../../api/documents'
import { Doc, FileLines, Gavel, Shield, Upload } from '../../components/icons'
import { BRAND } from '../../config/env'
import styles from './Analyze.module.scss'

const GUIDE = [
  {
    step: '1',
    title: '등기부등본',
    body: '대법원 인터넷등기소(iros.go.kr)에서 발급 가능합니다. 법적 효력 확인을 위해 "발급용" PDF 파일을 준비해 주세요.',
  },
  {
    step: '2',
    title: '임대차계약서',
    body: "공인중개사에게 요청하여 초안이나 스캔본을 받으세요. 특히 '특약사항' 부분이 명확하게 보이도록 촬영/스캔해야 합니다.",
  },
]

const METRICS = [
  { label: '담보 비율', value: '-- %' },
  { label: '신탁 채권', value: '없음' },
  { label: '소유권 위험', value: '정상' },
]

export function Analyze() {
  const navigate = useNavigate()
  const [contractName, setContractName] = useState('')
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const handleContract = async (file: File) => {
    setContractName(file.name)
    setIsAnalyzing(true)
    try {
      const result = await analyzeContract(file)
      navigate('/risk-report', { state: { documentAnalysis: result } })
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.inner}>
          <header className={styles.pageHead}>
            <h1 className={styles.title}>계약 전 권리분석 진단</h1>
            <p className={styles.subtitle}>
              서류를 업로드하여 즉각적인 위험 평가를 받아보세요. 보증금을 안전하게 보호하기 위해
              등기부등본과 임대차계약서를 정밀 분석합니다.
            </p>
          </header>

          <div className={styles.grid}>
            {/* 왼쪽: 업로드 + 서류 발급 안내 */}
            <div className={styles.left}>
              <div className={styles.uploads}>
                <UploadCard
                  title="등기부등본"
                  hint="부동산 등기사항전부증명서 (필수)"
                  icon={<Doc />}
                  dropIcon={<Upload />}
                  inputId="upload-register"
                />
                <UploadCard
                  title="임대차계약서"
                  hint="전/월세 계약서 (선택)"
                  icon={<Gavel />}
                  dropIcon={<FileLines />}
                  inputId="upload-contract"
                  filename={contractName}
                  loading={isAnalyzing}
                  onFile={handleContract}
                />
              </div>

              <section className={styles.guide}>
                <h2 className={styles.guideTitle}>서류 발급 안내</h2>
                <div className={styles.guideGrid}>
                  {GUIDE.map((g) => (
                    <div key={g.step} className={styles.guideItem}>
                      <span className={styles.guideNum}>{g.step}</span>
                      <div>
                        <h3>{g.title}</h3>
                        <p>{g.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* 오른쪽: 위험 점수 + 안전 보장 */}
            <aside className={styles.right}>
              <section className={styles.scoreCard}>
                <h2 className={styles.scoreTitle}>예상 위험 점수</h2>

                <div className={styles.gauge} aria-hidden>
                  <svg viewBox="0 0 200 116">
                    <defs>
                      <linearGradient id="riskArc" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#f59e0b" />
                        <stop offset="55%" stopColor="#ef4444" />
                        <stop offset="100%" stopColor="#dc2626" />
                      </linearGradient>
                    </defs>
                    <path d="M14 100 A86 86 0 0 1 186 100" className={styles.gaugeTrack} />
                    <path d="M14 100 A86 86 0 0 1 186 100" className={styles.gaugeArc} />
                    <line x1="100" y1="100" x2="100" y2="26" className={styles.gaugeNeedle} />
                    <circle cx="100" cy="100" r="7" className={styles.gaugeHub} />
                  </svg>
                  <div className={styles.gaugeStatus}>대기 중...</div>
                </div>
                <p className={styles.gaugeHelp}>문서를 업로드하여 분석을 시작하세요</p>

                <dl className={styles.metrics}>
                  {METRICS.map((m) => (
                    <div key={m.label} className={styles.metricRow}>
                      <dt>{m.label}</dt>
                      <dd>{m.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className={styles.assureCard}>
                <h3>{BRAND.nameKo} 안전 보장</h3>
                <p>
                  {BRAND.nameKo} AI는 실거래가와 대법원 판례 데이터를 대조하여 계약 체결 전 '전세
                  사기' 위험을 선제적으로 감지합니다.
                </p>
                <Link to="/chat" className={styles.assureLink}>
                  분석 방법론 자세히 보기
                </Link>
                <Shield className={styles.assureMark} />
              </section>
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}

type UploadCardProps = {
  title: string
  hint: string
  icon: React.ReactNode
  dropIcon: React.ReactNode
  inputId: string
  filename?: string
  loading?: boolean
  onFile?: (file: File) => void
}

function UploadCard({
  title,
  hint,
  icon,
  dropIcon,
  inputId,
  filename,
  loading = false,
  onFile,
}: UploadCardProps) {
  return (
    <div className={styles.uploadCard}>
      <div className={styles.uploadHead}>
        <h2>{title}</h2>
        <span className={styles.uploadIcon}>{icon}</span>
      </div>
      <p className={styles.uploadHint}>{hint}</p>
      <label
        htmlFor={inputId}
        className={styles.dropzone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const file = event.dataTransfer.files?.[0]
          if (file && onFile && !loading) void onFile(file)
        }}
      >
        <span className={styles.dropIcon}>{dropIcon}</span>
        <span className={styles.dropText}>
          {loading ? '계약서를 분석하고 있습니다...' : filename || '파일을 드래그하거나 클릭하여 업로드'}
        </span>
        <input
          id={inputId}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          className={styles.fileInput}
          disabled={loading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file && onFile) void onFile(file)
          }}
        />
      </label>
    </div>
  )
}
