import { describe, expect, it } from 'vitest'

import { contractTypeOf } from './contractType'

describe('contractTypeOf', () => {
  it('백엔드가 내려준 값이 있으면 월세 원문을 보지 않는다', () => {
    // 폴백이 백엔드 판정을 덮어쓰면 반전세(보증금 큰 월세)가 전세로 뒤집힌다.
    expect(contractTypeOf('월세', '없음')).toBe('월세')
    expect(contractTypeOf('전세', '70만원')).toBe('전세')
  })

  it.each([null, undefined, '', '   ', '없음', '해당 없음', '무', '-', '0', '0원'])(
    '차임이 %o 면 전세로 본다',
    (rent) => {
      expect(contractTypeOf(null, rent)).toBe('전세')
    },
  )

  it.each(['70만원', '700,000원', '금 오십만원정', '월 50만'])(
    '차임이 %o 면 월세로 본다',
    (rent) => {
      expect(contractTypeOf(null, rent)).toBe('월세')
    },
  )
})
