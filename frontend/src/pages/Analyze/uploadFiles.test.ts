import { describe, expect, it } from 'vitest'

import {
  MAX_FILE_MB,
  describeRejections,
  fileKey,
  formatFileSize,
  isPdf,
  mergeFiles,
  type Rejection,
} from './uploadFiles'

const MB = 1024 * 1024

function file(name: string, size = 10, lastModified = 1_700_000_000_000): File {
  return new File([new Uint8Array(size)], name, { lastModified })
}

describe('mergeFiles', () => {
  it('백엔드가 허용하는 확장자만 통과시킨다', () => {
    const incoming = [file('a.pdf'), file('b.PNG'), file('c.jpg'), file('d.jpeg')]

    const result = mergeFiles([], incoming)

    expect(result.files).toHaveLength(4)
    expect(result.rejected).toEqual([])
  })

  it('백엔드가 거부하는 확장자는 걸러내고 사유를 남긴다', () => {
    const result = mergeFiles([], [file('ok.pdf'), file('bad.webp'), file('bad.exe')])

    expect(result.files.map((f) => f.name)).toEqual(['ok.pdf'])
    expect(result.rejected).toEqual([
      { fileName: 'bad.webp', reason: 'extension' },
      { fileName: 'bad.exe', reason: 'extension' },
    ])
  })

  it('상한과 같은 크기는 통과하고 넘으면 거부한다', () => {
    const exact = mergeFiles([], [file('exact.pdf', MAX_FILE_MB * MB)])
    expect(exact.files).toHaveLength(1)
    expect(exact.rejected).toEqual([])

    const over = mergeFiles([], [file('over.pdf', MAX_FILE_MB * MB + 1)])
    expect(over.files).toHaveLength(0)
    expect(over.rejected).toEqual([{ fileName: 'over.pdf', reason: 'size' }])
  })

  it('이미 담긴 파일과 중복되면 담지 않되 사유를 남긴다', () => {
    const existing = file('contract.pdf')

    const result = mergeFiles([existing], [file('contract.pdf'), file('extra.pdf')])

    expect(result.files.map((f) => f.name)).toEqual(['contract.pdf', 'extra.pdf'])
    expect(result.rejected).toEqual([{ fileName: 'contract.pdf', reason: 'duplicate' }])
  })

  it('같은 배치 안의 중복도 한 번만 담는다', () => {
    const result = mergeFiles([], [file('same.pdf'), file('same.pdf')])

    expect(result.files).toHaveLength(1)
    expect(result.rejected).toEqual([{ fileName: 'same.pdf', reason: 'duplicate' }])
  })

  it('이름이 같아도 크기나 수정시각이 다르면 다른 파일로 본다', () => {
    const result = mergeFiles(
      [file('scan.jpg', 10, 1)],
      [file('scan.jpg', 20, 1), file('scan.jpg', 10, 2)],
    )

    expect(result.files).toHaveLength(3)
    expect(result.rejected).toEqual([])
  })

  it('한 번의 드롭에서 세 사유가 동시에 나올 수 있다', () => {
    const result = mergeFiles(
      [file('dup.pdf')],
      [file('ok.pdf'), file('bad.webp'), file('big.pdf', MAX_FILE_MB * MB + 1), file('dup.pdf')],
    )

    expect(result.files.map((f) => f.name)).toEqual(['dup.pdf', 'ok.pdf'])
    expect(result.rejected.map((r) => r.reason)).toEqual(['extension', 'size', 'duplicate'])
  })

  it('기존 목록은 그대로 두고 뒤에 이어 붙인다', () => {
    const current = [file('first.pdf')]

    const result = mergeFiles(current, [file('second.pdf')])

    expect(result.files.map((f) => f.name)).toEqual(['first.pdf', 'second.pdf'])
    expect(current).toHaveLength(1) // 원본 배열을 변형하지 않는다
  })
})

describe('describeRejections', () => {
  it('거부가 없으면 알릴 것도 없다', () => {
    expect(describeRejections([], '임대차계약서')).toEqual([])
  })

  it('서류명과 파일명을 문구에 담는다', () => {
    const [notice] = describeRejections([{ fileName: '스캔본.webp', reason: 'extension' }], '건축물대장')

    expect(notice.message).toBe('PDF·JPG·PNG 파일만 업로드할 수 있습니다 (건축물대장: 스캔본.webp)')
    expect(notice.type).toBe('error')
  })

  it('같은 사유가 여러 건이면 하나로 묶어 "외 N개" 로 알린다', () => {
    const rejected: Rejection[] = [
      { fileName: 'a.webp', reason: 'extension' },
      { fileName: 'b.gif', reason: 'extension' },
      { fileName: 'c.exe', reason: 'extension' },
    ]

    const notices = describeRejections(rejected, '임대차계약서')

    expect(notices).toHaveLength(1)
    expect(notices[0].message).toBe(
      'PDF·JPG·PNG 파일만 업로드할 수 있습니다 (임대차계약서: a.webp 외 2개)',
    )
  })

  it('용량 초과 문구에 상한을 그대로 노출한다', () => {
    const [notice] = describeRejections([{ fileName: '큰파일.pdf', reason: 'size' }], '등기부등본')

    expect(notice.message).toBe(
      `파일 하나당 최대 ${MAX_FILE_MB}MB까지 업로드할 수 있습니다 (등기부등본: 큰파일.pdf)`,
    )
    expect(notice.type).toBe('error')
  })

  it('중복은 실패가 아니므로 info 로 알린다', () => {
    const [notice] = describeRejections([{ fileName: '계약서.pdf', reason: 'duplicate' }], '임대차계약서')

    expect(notice.message).toBe('이미 추가한 파일입니다 (임대차계약서: 계약서.pdf)')
    expect(notice.type).toBe('info')
  })

  it('사유가 섞이면 심각한 순서(확장자 → 용량 → 중복)로 알린다', () => {
    const rejected: Rejection[] = [
      { fileName: 'dup.pdf', reason: 'duplicate' },
      { fileName: 'big.pdf', reason: 'size' },
      { fileName: 'bad.webp', reason: 'extension' },
    ]

    const notices = describeRejections(rejected, '임대차계약서')

    expect(notices.map((n) => n.type)).toEqual(['error', 'error', 'info'])
    expect(notices[0].message).toContain('bad.webp')
    expect(notices[1].message).toContain('big.pdf')
    expect(notices[2].message).toContain('dup.pdf')
  })
})

describe('fileKey', () => {
  it('이름·크기·수정시각을 합쳐 식별한다', () => {
    expect(fileKey(file('a.pdf', 10, 5))).toBe('a.pdf:10:5')
  })
})

describe('formatFileSize', () => {
  it('KB 와 MB 경계를 나눠 표기한다', () => {
    expect(formatFileSize(512)).toBe('512B')
    expect(formatFileSize(1024)).toBe('1KB')
    expect(formatFileSize(840 * 1024)).toBe('840KB')
    expect(formatFileSize(MB)).toBe('1.0MB')
    expect(formatFileSize(2.15 * MB)).toBe('2.1MB')
  })
})

describe('isPdf', () => {
  it('확장자 대소문자와 무관하게 판정한다', () => {
    expect(isPdf(file('a.PDF'))).toBe(true)
    expect(isPdf(file('a.jpg'))).toBe(false)
  })
})
