import type { ContractType } from '../../types/document'

/** 차임 칸이 "비어 있다"고 말하는 표현들. 서식마다 문구가 달라 넉넉하게 잡는다. */
const NO_RENT = /없음|없다|해당\s*없|미해당|^무$|^[-–—/]+$|^0+\s*원?$/

/**
 * 계약 유형은 백엔드 `terms.contract_type` 이 소유한다.
 *
 * 이 함수는 그 값이 없을 때 — 즉 **contract_type 이 추가되기 전에 저장된 분석**을 열었을 때만
 * 쓰는 폴백이다. 결과 전문이 JSONB 한 덩어리라 예전 레코드는 소급 채우지 못한다.
 *
 * 금액이 "금 오십만원정"처럼 한글로만 적힌 계약서가 흔해서 **숫자 유무로 판단하지 않는다.**
 * 비었다고 말하는 표현이면 전세, 무슨 값이든 적혀 있으면 월세로 본다.
 * (백엔드 `analyzer.py` 의 `_contract_type_from_rent` 와 같은 규칙 — 한쪽만 고치지 않는다.)
 */
export function contractTypeOf(
  contractType: ContractType | null | undefined,
  monthlyRent: string | null | undefined,
): ContractType {
  if (contractType) return contractType
  const text = (monthlyRent ?? '').trim()
  if (!text) return '전세'
  return NO_RENT.test(text) ? '전세' : '월세'
}
