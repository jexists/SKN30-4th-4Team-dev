import { describe, expect, it } from 'vitest'

import { addressCandidates } from './normalizeAddress'

describe('addressCandidates', () => {
  it('층·호 상세를 떼어낸 후보를 뒤에 붙인다', () => {
    expect(addressCandidates('서울특별시 강남구 테헤란로 123, 제3층 제301호')).toEqual([
      '서울특별시 강남구 테헤란로 123, 제3층 제301호',
      '서울특별시 강남구 테헤란로 123',
    ])
  })

  it('아파트 동·호수를 떼어낸다', () => {
    expect(addressCandidates('서울특별시 송파구 올림픽로 300 101동 1503호')).toEqual([
      '서울특별시 송파구 올림픽로 300 101동 1503호',
      '서울특별시 송파구 올림픽로 300',
    ])
  })

  it('법정동 이름은 지우지 않는다', () => {
    // "역삼동" 을 "101동" 과 같은 취급하면 지번주소가 통째로 깨진다.
    expect(addressCandidates('서울특별시 강남구 역삼동 123-4')).toEqual([
      '서울특별시 강남구 역삼동 123-4',
    ])
  })

  it('이미 깔끔한 도로명주소는 후보가 하나다', () => {
    expect(addressCandidates('경기도 성남시 분당구 판교역로 235')).toEqual([
      '경기도 성남시 분당구 판교역로 235',
    ])
  })

  it('괄호·마스킹 잔재·중복 공백을 정리한다', () => {
    expect(addressCandidates('  서울시   마포구 (양화로)  45  *** ')).toEqual([
      '서울시 마포구 양화로 45',
    ])
  })

  it('빈 문자열은 후보가 없다', () => {
    expect(addressCandidates('   ')).toEqual([])
  })
})
