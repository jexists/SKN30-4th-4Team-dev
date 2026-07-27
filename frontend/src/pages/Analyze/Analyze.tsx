import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  analyzeDocuments,
  type AnalyzeDocumentsResponse,
  type OcrDocument,
  type OcrField,
} from '../../api/documents'
import { isRetryable } from '../../api/apiErrorHandler'
import { ErrorState } from '../../components/ErrorState/ErrorState'
import { Doc, FileLines, Gavel, Shield, Upload } from '../../components/icons'
import { Modal } from '../../components/Modal/Modal'
import { BRAND } from '../../config/env'
import styles from './Analyze.module.scss'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg']

const DOCUMENT_LABELS: Record<string, string> = {
  lease_contract: '임대차계약서',
  special_terms: '특약사항',
  disclosure: '중개대상물 확인·설명서',
  mutual_aid: '공제증서',
}

const FIELD_LABELS: Record<string, string> = {
  address: '소재지',
  building_name: '건물명',
  unit_no: '호수',
  area_m2: '면적(㎡)',
  lessor_name: '임대인',
  lessor_birth: '임대인 생년월일',
  lessee_name: '임차인',
  deposit: '보증금',
  deposit_hangul: '한글 보증금',
  monthly_rent: '월 차임',
  maintenance_fee: '관리비',
  down_payment: '계약금',
  balance: '잔금',
  balance_date: '잔금일',
  contract_date: '계약일',
  term_start: '임대차 시작일',
  term_end: '임대차 종료일',
  handover_date: '인도일',
  agency_name: '중개사무소',
  agency_reg_no: '중개사무소 등록번호',
  brokerage_fee: '중개보수',
  holder: '예금주',
  bank: '은행',
  number: '계좌번호',
  text: '조항 원문',
  clause_count: '특약 수',
  max_amount: '채권최고액',
  set_date: '설정일',
  prior_deposits_total: '선순위 보증금 합계',
  description: '실제 권리관계',
  amount: '금액',
  items: '포함 항목',
  brokerage_fee_rate: '중개보수 요율',
  written_date: '작성일',
  issuer: '발급기관',
  coverage_amount: '공제금액',
  valid_from: '유효 시작일',
  valid_to: '유효 종료일',
  representative: '대표자',
  certificate_no: '증서번호',
  section_status: '기재 상태',
  has_seal_between_pages: '간인',
  has_corrections: '수정 흔적',
  has_seal_on_page: '페이지 날인',
  broker_signed: '중개사 서명·날인',
  is_handwritten: '수기 작성',
  numbering_source: '번호 출처',
}

const GUIDE = [
  {
    step: '1',
    title: '계약 서류 묶음 (필수)',
    body: '임대차계약서·특약사항·확인설명서·공제증서를 한 PDF로 합치거나, 한 문서의 사진을 업로드하세요.',
  },
  {
    step: '2',
    title: '등기부등본 (선택)',
    body: '대법원 인터넷등기소에서 발급한 PDF를 함께 올리면 원문 OCR 결과도 한 번에 확인할 수 있습니다.',
  },
]

type DisplayRow = {
  key: string
  label: string
  field?: OcrField
  value?: unknown
}

function isOcrField(value: unknown): value is OcrField {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.status === 'string' &&
    ['extracted', 'not_stated', 'unreadable'].includes(candidate.status)
  )
}

function flattenFields(value: unknown, path = ''): DisplayRow[] {
  if (isOcrField(value)) {
    const name =
      path
        .split('.')
        .at(-1)
        ?.replace(/\[\d+\]/g, '') ?? path
    return [{ key: path, label: FIELD_LABELS[name] ?? name, field: value }]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenFields(item, `${path}[${index + 1}]`))
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      flattenFields(child, path ? `${path}.${key}` : key),
    )
  }
  const name =
    path
      .split('.')
      .at(-1)
      ?.replace(/\[\d+\]/g, '') ?? path
  return [{ key: path, label: FIELD_LABELS[name] ?? name, value }]
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '예' : '아니요'
  if (typeof value === 'number')
    return Number.isInteger(value) ? value.toLocaleString('ko-KR') : String(value)
  if (Array.isArray(value)) return value.map(formatValue).join(', ')
  return String(value)
}

function validateFile(file: File): string | null {
  const lowerName = file.name.toLowerCase()
  if (!ACCEPTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return 'PDF, JPG 또는 PNG 파일만 선택해 주세요.'
  }
  if (file.size > MAX_FILE_BYTES) return '파일 하나당 20MB까지 업로드할 수 있습니다.'
  if (file.size === 0) return '빈 파일은 업로드할 수 없습니다.'
  return null
}

export function Analyze() {
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [registryFile, setRegistryFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<unknown>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [result, setResult] = useState<AnalyzeDocumentsResponse | null>(null)

  const selectFile = (kind: 'contract' | 'registry', file: File) => {
    const error = validateFile(file)
    if (error) {
      setValidationError(error)
      return
    }
    setValidationError(null)
    setRequestError(null)
    if (kind === 'contract') setContractFile(file)
    else setRegistryFile(file)
  }

  const runAnalysis = async () => {
    if (!contractFile) {
      setValidationError('계약 서류 묶음을 먼저 선택해 주세요.')
      return
    }
    setValidationError(null)
    setRequestError(null)
    setIsAnalyzing(true)
    try {
      setResult(await analyzeDocuments(contractFile, registryFile ?? undefined))
    } catch (error) {
      setRequestError(error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const contractData = result?.contract.data
  const metricValues = result
    ? [
        { label: '분류 문서', value: `${contractData?.documents.length ?? 0}종` },
        { label: '개인정보 마스킹', value: `${contractData?.mask_count ?? 0}건` },
        { label: '확인 필요 필드', value: `${result.engine_input.unknowns.length}건` },
      ]
    : [
        { label: '분류 문서', value: '—' },
        { label: '개인정보 마스킹', value: '—' },
        { label: '확인 필요 필드', value: '—' },
      ]

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.inner}>
          <header className={styles.pageHead}>
            <h1 className={styles.title}>계약 서류 OCR 확인</h1>
            <p className={styles.subtitle}>
              계약 서류를 올리면 네 종류의 문서를 자동 분류하고, 항목별 원문·위치·신뢰도와 정규화
              값을 함께 보여드립니다.
            </p>
          </header>

          <div className={styles.grid}>
            <div className={styles.left}>
              <div className={styles.uploads}>
                <UploadCard
                  title="계약 서류 묶음"
                  hint="임대차계약서 포함 (필수)"
                  icon={<Gavel />}
                  dropIcon={<Upload />}
                  inputId="upload-contract"
                  file={contractFile}
                  onSelect={(file) => selectFile('contract', file)}
                  onRemove={() => setContractFile(null)}
                />
                <UploadCard
                  title="등기부등본"
                  hint="등기사항전부증명서 (선택)"
                  icon={<Doc />}
                  dropIcon={<FileLines />}
                  inputId="upload-registry"
                  file={registryFile}
                  onSelect={(file) => selectFile('registry', file)}
                  onRemove={() => setRegistryFile(null)}
                />
              </div>

              {validationError && <p className={styles.validationError}>{validationError}</p>}
              {requestError !== null && (
                <ErrorState
                  message="문서 분석을 완료하지 못했습니다."
                  onRetry={isRetryable(requestError) ? runAnalysis : undefined}
                />
              )}

              <button
                type="button"
                className={styles.analyzeButton}
                disabled={!contractFile || isAnalyzing}
                onClick={runAnalysis}
              >
                {isAnalyzing ? 'OCR 처리 중…' : 'OCR 분석 시작'}
              </button>
              {isAnalyzing && (
                <p className={styles.progressText} role="status">
                  PDF 텍스트층을 확인하고, 필요한 페이지를 OCR 처리하고 있습니다.
                </p>
              )}

              <section className={styles.guide}>
                <h2 className={styles.guideTitle}>업로드 안내</h2>
                <div className={styles.guideGrid}>
                  {GUIDE.map((guide) => (
                    <div key={guide.step} className={styles.guideItem}>
                      <span className={styles.guideNum}>{guide.step}</span>
                      <div>
                        <h3>{guide.title}</h3>
                        <p>{guide.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <aside className={styles.right}>
              <section className={styles.scoreCard}>
                <h2 className={styles.scoreTitle}>OCR 처리 현황</h2>
                <div className={styles.statusIcon} aria-hidden>
                  <FileLines />
                </div>
                <p className={styles.gaugeStatus}>
                  {isAnalyzing ? '분석 중' : result ? '추출 완료' : '대기 중'}
                </p>
                <p className={styles.gaugeHelp}>
                  {result
                    ? '신뢰도가 낮은 항목은 결과에서 강조됩니다.'
                    : '계약 서류를 업로드해 주세요.'}
                </p>
                <dl className={styles.metrics}>
                  {metricValues.map((metric) => (
                    <div key={metric.label} className={styles.metricRow}>
                      <dt>{metric.label}</dt>
                      <dd>{metric.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              <section className={styles.assureCard}>
                <h3>{BRAND.nameKo} OCR 원칙</h3>
                <p>
                  추출 값과 문서 원문을 분리해 보존하고, 신뢰도가 낮거나 읽지 못한 필드는 임의로
                  채우지 않고 확인 대상으로 표시합니다.
                </p>
                <Link to="/legal-basis" className={styles.assureLink}>
                  분석 기준 자세히 보기
                </Link>
                <Shield className={styles.assureMark} />
              </section>
            </aside>
          </div>
        </div>
      </main>

      <ResultModal result={result} onClose={() => setResult(null)} />
    </div>
  )
}

type UploadCardProps = {
  title: string
  hint: string
  icon: React.ReactNode
  dropIcon: React.ReactNode
  inputId: string
  file: File | null
  onSelect: (file: File) => void
  onRemove: () => void
}

function UploadCard({
  title,
  hint,
  icon,
  dropIcon,
  inputId,
  file,
  onSelect,
  onRemove,
}: UploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const acceptFile = (files: FileList | null) => {
    if (files?.[0]) onSelect(files[0])
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className={styles.uploadCard}>
      <div className={styles.uploadHead}>
        <h2>{title}</h2>
        <span className={styles.uploadIcon}>{icon}</span>
      </div>
      <p className={styles.uploadHint}>{hint}</p>
      {file ? (
        <div className={styles.selectedFile}>
          <span className={styles.selectedFileName}>{file.name}</span>
          <span className={styles.selectedFileSize}>{(file.size / 1024 / 1024).toFixed(1)}MB</span>
          <button type="button" onClick={onRemove}>
            제거
          </button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          className={styles.dropzone}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            acceptFile(event.dataTransfer.files)
          }}
        >
          <span className={styles.dropIcon}>{dropIcon}</span>
          <span className={styles.dropText}>파일을 드래그하거나 클릭하여 업로드</span>
          <span className={styles.fileRule}>PDF·JPG·PNG, 최대 20MB</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,image/png,image/jpeg,application/pdf"
            className={styles.fileInput}
            onChange={(event) => acceptFile(event.target.files)}
          />
        </label>
      )}
    </div>
  )
}

function ResultModal({
  result,
  onClose,
}: {
  result: AnalyzeDocumentsResponse | null
  onClose: () => void
}) {
  const [showRaw, setShowRaw] = useState(false)
  if (!result) return null

  const contract = result.contract.data
  const registry = result.registry?.data
  const close = () => {
    setShowRaw(false)
    onClose()
  }
  return (
    <Modal open title="OCR 추출 결과" onClose={close}>
      <div className={styles.resultSummary}>
        <SummaryItem label="처리 페이지" value={`${contract?.page_count ?? 0}쪽`} />
        <SummaryItem label="마스킹" value={`${contract?.mask_count ?? 0}건`} />
        <SummaryItem label="확인 필요" value={`${result.engine_input.unknowns.length}건`} />
      </div>

      {contract?.review_required && (
        <p className={styles.reviewNotice}>일부 항목의 신뢰도가 낮아 원문 확인이 필요합니다.</p>
      )}
      {!!contract?.missing_doc_types.length && (
        <p className={styles.missingNotice}>
          찾지 못한 문서:{' '}
          {contract.missing_doc_types.map((type) => DOCUMENT_LABELS[type] ?? type).join(', ')}
        </p>
      )}

      <div className={styles.documentList}>
        {contract?.documents.map((document) => (
          <DocumentResult key={document.doc_type} document={document} />
        ))}
      </div>

      {result.registry?.status === 'failed' && (
        <p className={styles.registryError}>등기부등본 OCR 실패: {result.registry.error}</p>
      )}

      <button
        type="button"
        className={styles.rawToggle}
        onClick={() => setShowRaw((open) => !open)}
      >
        {showRaw ? 'OCR 원문 닫기' : 'OCR 원문 보기'}
      </button>
      {showRaw && (
        <div className={styles.rawPages}>
          <RawPages title="계약 서류" pages={contract?.ocr_pages ?? []} />
          {registry && <RawPages title="등기부등본" pages={registry.ocr_pages} />}
        </div>
      )}
    </Modal>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DocumentResult({ document }: { document: OcrDocument }) {
  const rows = flattenFields(document.fields)
  return (
    <section className={styles.documentResult}>
      <header>
        <h3>{DOCUMENT_LABELS[document.doc_type]}</h3>
        <span>{Math.round(document.overall_confidence * 100)}%</span>
      </header>
      <dl className={styles.fieldList}>
        {rows.map((row) => {
          const field = row.field
          const needsReview = field && (field.status !== 'extracted' || field.confidence < 0.9)
          return (
            <div key={row.key} className={needsReview ? styles.fieldReview : styles.fieldRow}>
              <dt>{row.label}</dt>
              <dd>
                <span>{formatValue(field ? field.value : row.value)}</span>
                {field && (
                  <small>
                    {field.status === 'not_stated'
                      ? '미기재'
                      : field.status === 'unreadable'
                        ? '인식 불가'
                        : `${Math.round(field.confidence * 100)}% · ${field.method}`}
                  </small>
                )}
                {field?.raw && field.raw !== formatValue(field.value) && <em>원문: {field.raw}</em>}
              </dd>
            </div>
          )
        })}
      </dl>
    </section>
  )
}

function RawPages({ title, pages }: { title: string; pages: { page: number; text: string }[] }) {
  return (
    <section>
      <h3>{title}</h3>
      {pages.map((page) => (
        <div key={page.page} className={styles.rawPage}>
          <strong>{page.page}쪽</strong>
          <pre>{page.text || '(인식된 텍스트 없음)'}</pre>
        </div>
      ))}
    </section>
  )
}
