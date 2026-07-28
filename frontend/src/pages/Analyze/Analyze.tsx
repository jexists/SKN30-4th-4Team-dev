import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Building, Check, Doc, FileLines, Gavel, Search, Shield, Upload } from '../../components/icons'
import { BRAND } from '../../config/env'
import styles from './Analyze.module.scss'

const UPLOAD_SLOTS = ['register', 'contract', 'building'] as const
type SlotKey = (typeof UPLOAD_SLOTS)[number]

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
  {
    step: '3',
    title: '건축물대장',
    body: '정부24(plus.gov.kr)에서 발급 가능합니다. 법적 효력 확인을 위해 "발급용" PDF 파일을 준비해 주세요.',
  },
]

export function Analyze() {
  const [files, setFiles] = useState<Record<SlotKey, File | null>>({
    register: null,
    contract: null,
    building: null,
  })

  const uploadedCount = UPLOAD_SLOTS.filter((slot) => files[slot] !== null).length
  const allUploaded = uploadedCount === UPLOAD_SLOTS.length

  function setSlotFile(slot: SlotKey, file: File | null) {
    setFiles((prev) => ({ ...prev, [slot]: file }))
  }

  return (
    <div className={styles.page}>
      <div className={styles.main}>
        <div className={styles.inner}>
          <header className={styles.pageHead}>
            <div>
              <h1 className={styles.title}>계약 전 권리분석 진단</h1>
              <p className={styles.subtitle}>
                서류를 업로드하여 즉각적인 위험 평가를 받아보세요. 보증금을 안전하게 보호하기 위해
                등기부등본과 임대차계약서를 정밀 분석합니다.
              </p>
            </div>
          </header>

          <div className={styles.left}>
            <div className={styles.uploads}>
              <UploadCard
                title="등기부등본"
                hint="부동산 등기사항전부증명서"
                icon={<Doc />}
                dropIcon={<Upload />}
                inputId="upload-register"
                onFileChange={(file) => setSlotFile('register', file)}
              />
              <UploadCard
                title="임대차계약서"
                hint="전/월세 계약서"
                icon={<Gavel />}
                dropIcon={<FileLines />}
                inputId="upload-contract"
                onFileChange={(file) => setSlotFile('contract', file)}
              />
              <UploadCard
                title="건축물대장"
                hint="일반 / 집합 건축물대장"
                icon={<Building />}
                dropIcon={<Doc />}
                inputId="upload-building-register"
                onFileChange={(file) => setSlotFile('building', file)}
              />
            </div>

            <div className={styles.statusBar}>
              <div className={styles.statusLeft}>
                <span
                  className={
                    allUploaded ? `${styles.statusIcon} ${styles.statusIconDone}` : styles.statusIcon
                  }
                >
                  <Check />
                </span>
                <div>
                  <p className={styles.statusTitle}>{uploadedCount}/3 서류 업로드 완료</p>
                  <p className={styles.statusSub}>
                    {allUploaded
                      ? '모든 서류가 준비되었습니다'
                      : `${UPLOAD_SLOTS.length - uploadedCount}개 서류를 더 업로드해주세요`}
                  </p>
                </div>
              </div>
              <button type="button" className={styles.diagnoseBtn} disabled={!allUploaded}>
                <Search /> OCR 진단하기
              </button>
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

            <section className={styles.assureCard}>
              <h3>{BRAND.nameKo} 안전 보장</h3>
              <p>
                {BRAND.nameKo} AI는 실거래가와 대법원 판례 데이터를 대조하여 계약 체결 전 '전세 사기'
                위험을 선제적으로 감지합니다.
              </p>
              <Link to="/chat" className={styles.assureLink}>
                분석 방법론 자세히 보기
              </Link>
              <Shield className={styles.assureMark} />
            </section>
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
  onFileChange: (file: File | null) => void
}

function UploadCard({ title, hint, icon, dropIcon, inputId, onFileChange }: UploadCardProps) {
  return (
    <div className={styles.uploadCard}>
      <div className={styles.uploadHead}>
        <h2>{title}</h2>
        <span className={styles.uploadIcon}>{icon}</span>
      </div>
      <p className={styles.uploadHint}>{hint}</p>
      <label htmlFor={inputId} className={styles.dropzone}>
        <span className={styles.dropIcon}>{dropIcon}</span>
        <span className={styles.dropText}>파일을 드래그하거나 클릭하여 업로드</span>
        <input
          id={inputId}
          type="file"
          accept=".pdf,image/*"
          className={styles.fileInput}
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
      </label>
    </div>
  )
}
