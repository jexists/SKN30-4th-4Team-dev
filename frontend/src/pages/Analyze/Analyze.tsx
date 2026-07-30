import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { startAnalysis } from '../../api/analyses'
import { Modal } from '../../components/Modal/Modal'
import { showToast } from '../../components/Toast/toastStore'
import {
  AddCircle,
  Building,
  Check,
  Close,
  Doc,
  FileLines,
  Gavel,
  Search,
  Shield,
  Upload,
} from '../../components/icons'
import { BRAND } from '../../config/env'
import { markAnalysisStarted, useAnalysisOutcome } from '../../hooks/useNotifications'
import styles from './Analyze.module.scss'
import {
  ACCEPT_ATTR,
  MAX_TOTAL_FILES,
  describeRejections,
  fileKey,
  formatFileSize,
  isPdf,
  mergeFiles,
} from './uploadFiles'

type SlotKey = 'register' | 'contract' | 'building'

interface SlotConfig {
  key: SlotKey
  /** 거부 토스트 문구에도 그대로 쓰이므로 카드 제목과 한 곳에서 관리한다. */
  title: string
  hint: string
  icon: ReactNode
  dropIcon: ReactNode
  inputId: string
}

const SLOTS: SlotConfig[] = [
  {
    key: 'contract',
    title: '임대차계약서',
    hint: '전/월세 계약서',
    icon: <Gavel />,
    dropIcon: <FileLines />,
    inputId: 'upload-contract',
  },
  {
    key: 'register',
    title: '등기부등본',
    hint: '부동산 등기사항전부증명서',
    icon: <Doc />,
    dropIcon: <Upload />,
    inputId: 'upload-register',
  },
  {
    key: 'building',
    title: '건축물대장',
    hint: '일반 / 집합 건축물대장',
    icon: <Building />,
    dropIcon: <Doc />,
    inputId: 'upload-building-register',
  },
]

const GUIDE = [
  {
    step: '1',
    title: '임대차계약서',
    body: "공인중개사에게 요청하여 초안이나 스캔본을 받으세요. 특히 '특약사항' 부분이 명확하게 보이도록 촬영/스캔해야 합니다.",
  },
  {
    step: '2',
    title: '등기부등본',
    body: (
      <>
        대법원{' '}
        <a href="https://www.iros.go.kr/" target="_blank" rel="noreferrer">
          인터넷등기소(iros.go.kr)
        </a>
        에서 발급 가능합니다. 법적 효력 확인을 위해 &quot;발급용&quot; PDF 파일을 준비해 주세요.
      </>
    ),
  },
  {
    step: '3',
    title: '건축물대장',
    body: (
      <>
        <a href="https://plus.gov.kr/" target="_blank" rel="noreferrer">
          정부24(plus.gov.kr)
        </a>
        에서 발급 가능합니다. 법적 효력 확인을 위해 &quot;발급용&quot; PDF 파일을 준비해 주세요.
      </>
    ),
  },
]

export function Analyze() {
  const navigate = useNavigate()
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  // 접수된 작업 id. Modal 을 닫아도 남겨 두어 진행 중임을 화면에 계속 보여준다.
  const [startedJobId, setStartedJobId] = useState<string | null>(null)
  const analysisOutcome = useAnalysisOutcome(startedJobId)
  const [modalOpen, setModalOpen] = useState(false)
  const idempotencyKey = useRef<string | null>(null)
  const [files, setFiles] = useState<Record<SlotKey, File[]>>({
    register: [],
    contract: [],
    building: [],
  })

  const uploadedCount = SLOTS.filter((slot) => files[slot.key].length > 0).length
  const allUploaded = uploadedCount === SLOTS.length
  const totalCount = SLOTS.reduce((sum, slot) => sum + files[slot.key].length, 0)
  const analysisStarted = startedJobId !== null
  const analysisCompleted = analysisOutcome === 'SUCCEEDED'
  const analysisFailed = analysisOutcome === 'FAILED'
  const analysisRunning = analysisStarted && !analysisCompleted && !analysisFailed

  function addFiles(slot: SlotConfig, incoming: FileList | null) {
    if (analysisStarted || !incoming || incoming.length === 0) return
    // 서류 한 종류가 여러 장으로 스캔돼 오는 일이 흔하므로 카드마다 파일을 여러 개 담는다.
    // 상한은 카드별이 아니라 전체 합계 — 백엔드 CONTRACT_MAX_FILES 와 같은 기준이다.
    const { files: merged, rejected } = mergeFiles(
      files[slot.key],
      Array.from(incoming),
      MAX_TOTAL_FILES - totalCount,
    )
    idempotencyKey.current = null // 다른 서류 묶음이면 다른 요청이다
    setFiles((prev) => ({ ...prev, [slot.key]: merged }))
    // 거부는 카드 안 문구가 아니라 토스트로 알린다 — 어떤 서류의 어떤 파일인지까지 담긴다.
    for (const notice of describeRejections(rejected, slot.title)) {
      showToast(notice.message, notice.type)
    }
  }

  function removeFile(slot: SlotKey, key: string) {
    if (analysisStarted) return
    idempotencyKey.current = null
    setFiles((prev) => ({ ...prev, [slot]: prev[slot].filter((file) => fileKey(file) !== key) }))
  }

  async function handleDiagnose() {
    // 백엔드는 파일을 순서대로 이어붙여 한 번에 분석한다 — 같은 서류의 장들이 흩어지지
    // 않도록 카드 단위로 묶어서 보낸다.
    const documents = SLOTS.flatMap((slot) => files[slot.key])
    if (!allUploaded || isAnalyzing || (analysisStarted && !analysisFailed)) return
    if (analysisFailed) idempotencyKey.current = null
    setIsAnalyzing(true)
    try {
      // 같은 서류 묶음으로 다시 눌러도 분석이 두 번 돌지 않게 한다. 응답을 못 받았을 뿐
      // 서버는 이미 접수했을 수 있기 때문이다(키는 파일이 바뀌면 새로 만든다).
      idempotencyKey.current ??= crypto.randomUUID()
      const job = await startAnalysis(documents, idempotencyKey.current)
      markAnalysisStarted()
      setStartedJobId(job.id)
      setModalOpen(true)
    } catch {
      // 문구는 서버가 소유한다 — client.ts 가 이미 오류 모달을 띄웠다.
      // 여기서는 안내 Modal 을 열지 않는 것으로 충분하다.
    } finally {
      setIsAnalyzing(false)
    }
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
              {SLOTS.map((slot) => (
                <UploadCard
                  key={slot.key}
                  title={slot.title}
                  hint={slot.hint}
                  icon={slot.icon}
                  dropIcon={slot.dropIcon}
                  inputId={slot.inputId}
                  files={files[slot.key]}
                  locked={analysisStarted}
                  onAdd={(list) => addFiles(slot, list)}
                  onRemove={(fileId) => removeFile(slot.key, fileId)}
                />
              ))}
            </div>

            <div className={styles.statusBar}>
              <div className={styles.statusLeft}>
                <span
                  className={
                    allUploaded
                      ? `${styles.statusIcon} ${styles.statusIconDone}`
                      : styles.statusIcon
                  }
                >
                  <Check />
                </span>
                <div>
                  <p className={styles.statusTitle}>
                    {analysisCompleted
                      ? 'AI 분석이 완료되었습니다'
                      : analysisFailed
                        ? 'AI 분석을 완료하지 못했습니다'
                        : analysisRunning
                          ? 'AI 분석 진행 중'
                          : `${uploadedCount}/${SLOTS.length} 서류 업로드 완료`}
                  </p>
                  <p className={styles.statusSub}>
                    {analysisCompleted
                      ? '분석 결과를 바로 확인할 수 있습니다'
                      : analysisFailed
                        ? '업로드한 파일은 유지됩니다. 다시 분석을 시도해주세요'
                        : analysisRunning
                          ? '창을 닫아도 분석은 백그라운드에서 계속 진행됩니다'
                          : allUploaded
                            ? '모든 서류가 준비되었습니다'
                            : `${SLOTS.length - uploadedCount}개 서류를 더 업로드해주세요`}
                  </p>
                </div>
              </div>
              {/* 접수된 뒤에도 버튼을 잠근 채 남겨 둔다 — 왜 다시 못 누르는지(중복 방지)가
                  화면으로 설명되고, 알림을 놓쳐도 "결과 보기"로 되돌아갈 길이 생긴다. */}
              <div className={styles.statusActions}>
                {analysisCompleted && startedJobId ? (
                  <Link to={`/risk-report/${startedJobId}`} className={styles.resultButton}>
                    결과 보기
                  </Link>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.diagnoseBtn}
                      disabled={!allUploaded || isAnalyzing || analysisRunning}
                      onClick={handleDiagnose}
                    >
                      <Search />{' '}
                      {isAnalyzing
                        ? '접수 중...'
                        : analysisFailed
                          ? '다시 분석하기'
                          : analysisRunning
                            ? '분석 진행 중...'
                            : 'OCR 진단하기'}
                    </button>
                    {analysisRunning && (
                      <button type="button" className={styles.resultButton} disabled>
                        결과 보기
                      </button>
                    )}
                  </>
                )}
              </div>
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
                {BRAND.nameKo} AI는 실거래가와 대법원 판례 데이터를 대조하여 계약 체결 전 '전세
                사기' 위험을 선제적으로 감지합니다.
              </p>
              {/* <Link to="/chat" className={styles.assureLink}>
                분석 방법론 자세히 보기
              </Link> */}
              <Shield className={styles.assureMark} />
            </section>
          </div>
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="AI 분석을 시작했습니다."
        describedBy="analysis-started-desc"
      >
        <div id="analysis-started-desc" className={styles.startedBody}>
          <p>분석에는 약 30초~2분 정도 소요될 수 있습니다.</p>
          <p>분석이 완료되면 알림으로 알려드리겠습니다.</p>
          <p>창을 닫아도 분석은 백그라운드에서 계속 진행됩니다.</p>
          <p className={styles.startedHint}>
            기다리시는 동안 AI 상담을 이용해 궁금한 점을 물어보세요.
          </p>
        </div>
        <div className={styles.startedActions}>
          <button type="button" className={styles.startedGhost} onClick={() => setModalOpen(false)}>
            닫기
          </button>
          <button type="button" className={styles.startedPrimary} onClick={() => navigate('/chat')}>
            AI 상담하기
          </button>
        </div>
      </Modal>
    </div>
  )
}

type UploadCardProps = {
  title: string
  hint: string
  icon: ReactNode
  dropIcon: ReactNode
  inputId: string
  files: File[]
  locked: boolean
  onAdd: (list: FileList | null) => void
  onRemove: (key: string) => void
}

function UploadCard({
  title,
  hint,
  icon,
  dropIcon,
  inputId,
  files,
  locked,
  onAdd,
  onRemove,
}: UploadCardProps) {
  // 드롭 영역과 "파일 추가" 영역이 같은 동작을 공유한다.
  const dropProps = {
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      onAdd(event.dataTransfer.files)
    },
  }

  return (
    <div className={styles.uploadCard}>
      <div className={styles.uploadHead}>
        <h2>{title}</h2>
        <span className={styles.uploadIcon}>{icon}</span>
      </div>
      <p className={styles.uploadHint}>{hint}</p>

      {/* 파일이 몇 개든 높이가 고정된다 — 넘치면 목록 안에서만 스크롤한다. */}
      <div className={styles.dropArea}>
        {files.length === 0 ? (
          <label htmlFor={inputId} className={styles.dropzone} {...dropProps}>
            <span className={styles.dropIcon}>{dropIcon}</span>
            <span className={styles.dropText}>파일을 드래그하거나 클릭하여 업로드</span>
          </label>
        ) : (
          <>
            {/* 제거 버튼 클릭이 파일 선택창을 열지 않도록 목록은 label 바깥에 둔다. */}
            <ul className={styles.fileList} {...dropProps}>
              {files.map((file) => (
                <li key={fileKey(file)} className={styles.fileRow}>
                  <span className={styles.fileRowIcon}>
                    {isPdf(file) ? <FileLines /> : <Doc />}
                  </span>
                  <span className={styles.fileName} title={file.name}>
                    {file.name}
                  </span>
                  <span className={styles.fileSize}>{formatFileSize(file.size)}</span>
                  {!locked && (
                    <button
                      type="button"
                      className={styles.fileRemove}
                      aria-label={`${file.name} 제거`}
                      onClick={() => onRemove(fileKey(file))}
                    >
                      <Close />
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {!locked && (
              <label htmlFor={inputId} className={styles.addZone} {...dropProps}>
                <AddCircle />
                <span>파일 추가</span>
              </label>
            )}
          </>
        )}
      </div>

      <input
        id={inputId}
        type="file"
        multiple
        accept={ACCEPT_ATTR}
        disabled={locked}
        className={styles.fileInput}
        onChange={(event) => {
          onAdd(event.target.files)
          // 같은 파일을 지웠다 다시 고를 때도 change 가 뜨도록 비운다.
          event.target.value = ''
        }}
      />
    </div>
  )
}
