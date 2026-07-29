// 업로드 카드의 파일 검증·중복제거와 거부 사유 문구. 백엔드가 최종 게이트키퍼지만,
// 여기서 먼저 걸러야 사용자가 20MB 를 다 올린 뒤에 413 을 보는 일이 없다.
//
// 거부는 전부 토스트로 알린다(화면에 인라인 문구를 두지 않는다) — 문구 조립까지 여기서
// 끝내고 화면은 showToast 에 넘기기만 한다.

import type { ToastType } from '../../components/Toast/toastStore'

/** backend/app/api/routes/documents.py 의 허용 확장자 집합과 같아야 한다. */
export const ACCEPTED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'] as const

/** <input accept> 속성값. image/* 는 백엔드가 거부하는 webp·gif 까지 열어주므로 쓰지 않는다. */
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',')

/** backend 의 CONTRACT_MAX_FILE_MB(기본 20) 와 같아야 한다. */
export const MAX_FILE_MB = 20

/**
 * backend 의 CONTRACT_MAX_FILES(기본 10) 와 같아야 한다.
 *
 * 서류 종류별이 아니라 **한 번에 보내는 전체 파일 수** 상한이다 — 등기부등본처럼 여러 장으로
 * 스캔된 서류가 있어 카드 하나에 파일이 여러 개 담긴다.
 */
export const MAX_TOTAL_FILES = 10

const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
const KB = 1024
const MB = 1024 * 1024

/** 거부 사유. 심각한 순서대로 나열한다 — 토스트도 이 순서로 나간다. */
export const REJECT_REASONS = ['extension', 'size', 'limit', 'duplicate'] as const
export type RejectReason = (typeof REJECT_REASONS)[number]

export interface Rejection {
  fileName: string
  reason: RejectReason
}

export interface MergeResult {
  files: File[]
  /** 목록에 들어가지 못한 파일들. 비어 있으면 전부 통과한 것. */
  rejected: Rejection[]
}

export interface RejectionNotice {
  message: string
  type: ToastType
}

// 중복은 "그 파일이 목록에 있다"는 사용자의 목적이 이미 이뤄진 상태라 실패가 아니다 → info.
const REASON_TOAST: Record<RejectReason, ToastType> = {
  extension: 'error',
  size: 'error',
  limit: 'error',
  duplicate: 'info',
}

const REASON_MESSAGE: Record<RejectReason, string> = {
  extension: 'PDF·JPG·PNG 파일만 업로드할 수 있습니다',
  size: `파일 하나당 최대 ${MAX_FILE_MB}MB까지 업로드할 수 있습니다`,
  limit: `서류는 모두 합쳐 최대 ${MAX_TOTAL_FILES}개까지 업로드할 수 있습니다`,
  duplicate: '이미 추가한 파일입니다',
}

/** 같은 파일인지 판정하는 키. React list key 로도 같이 쓴다. */
export function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export function formatFileSize(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)}MB`
  if (bytes >= KB) return `${Math.round(bytes / KB)}KB`
  return `${bytes}B`
}

export function isPdf(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf')
}

function hasAcceptedExtension(file: File): boolean {
  const name = file.name.toLowerCase()
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

/**
 * 기존 목록에 새 파일들을 검증·중복제거해서 합치고, 못 담은 파일은 사유와 함께 돌려준다.
 *
 * `capacity` 는 이번에 **새로 담을 수 있는 개수**다(기본 무제한). 상한이 서류 카드 하나가
 * 아니라 전체 합계라서, 남은 자리는 호출자만 알 수 있으므로 인자로 받는다. 중복은 자리를
 * 차지하지 않으므로 capacity 검사보다 먼저 걸러낸다.
 */
export function mergeFiles(
  current: File[],
  incoming: File[],
  capacity = Number.POSITIVE_INFINITY,
): MergeResult {
  const seen = new Set(current.map(fileKey))
  const accepted: File[] = []
  const rejected: Rejection[] = []

  for (const file of incoming) {
    if (!hasAcceptedExtension(file)) {
      rejected.push({ fileName: file.name, reason: 'extension' })
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push({ fileName: file.name, reason: 'size' })
      continue
    }
    const key = fileKey(file)
    if (seen.has(key)) {
      // 조용히 넘기면 "왜 목록이 안 늘지?" 가 된다. 사유를 남겨 화면이 알리게 한다.
      rejected.push({ fileName: file.name, reason: 'duplicate' })
      continue
    }
    if (accepted.length >= capacity) {
      rejected.push({ fileName: file.name, reason: 'limit' })
      continue
    }
    seen.add(key)
    accepted.push(file)
  }

  return { files: [...current, ...accepted], rejected }
}

/**
 * 거부 목록을 사유별로 묶어 토스트 문구를 만든다. docLabel 은 '임대차계약서' 같은 서류명.
 *
 * 파일명 바로 뒤에 조사(은/는)를 붙이면 받침 유무에 따라 어색해지므로, 사유를 앞에 두고
 * 대상은 괄호로 덧붙인다.
 */
export function describeRejections(rejected: Rejection[], docLabel: string): RejectionNotice[] {
  return REJECT_REASONS.flatMap((reason) => {
    const names = rejected.filter((item) => item.reason === reason).map((item) => item.fileName)
    if (names.length === 0) return []

    const target = names.length === 1 ? names[0] : `${names[0]} 외 ${names.length - 1}개`
    return [
      {
        message: `${REASON_MESSAGE[reason]} (${docLabel}: ${target})`,
        type: REASON_TOAST[reason],
      },
    ]
  })
}
