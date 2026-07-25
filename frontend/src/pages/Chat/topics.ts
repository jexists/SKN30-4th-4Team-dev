import { BRAND } from '../../config/env'

/**
 * 첫 화면(Hero)의 내용 한 벌. 추천 주제를 고르면 제목·설명·추천 질문이 통째로 바뀐다.
 *
 * 변경 빈도가 낮아 API 대신 상수로 둔다 — 문구를 고칠 때 이 파일만 보면 된다.
 */
export type Topic = {
  id: string
  /** 사이드바 칩에 쓰는 짧은 이름. 기본 주제는 칩이 없어 비어 있다. */
  label: string
  title: string
  /** 줄바꿈은 `\n` 으로 둔다(렌더 쪽에서 white-space 로 살린다). */
  description: string
  questions: string[]
}

/** 아무 주제도 고르지 않은 초기 상태. */
export const DEFAULT_TOPIC: Topic = {
  id: 'default',
  label: '',
  title: '무엇을 도와드릴까요?',
  description: `전·월세 계약과 임대차 분쟁에 대해 물어보세요.\n${BRAND.name}가 관련 법령과 판례를 기반으로 답변드립니다.`,
  questions: [
    '전세 계약이 끝났는데 보증금을 안 돌려줘요. 어떻게 해야 하나요?',
    '집주인이 갑자기 월세를 크게 올려달라고 합니다. 거절할 수 있나요?',
    '계약 갱신을 요구했는데 집주인이 실거주를 이유로 거절해요.',
    '이사 나갈 때 집주인이 도배·장판 비용을 청구합니다. 내야 하나요?',
  ],
}

export const TOPICS: Topic[] = [
  {
    id: 'deposit',
    label: '보증금 반환',
    title: '보증금 반환',
    description: '보증금 반환과 관련된 자주 묻는 질문입니다.',
    questions: [
      '전세 계약이 끝났는데 보증금을 안 돌려줘요.',
      '집주인이 연락을 받지 않습니다.',
      '임차권등기명령은 언제 신청하나요?',
      '보증금 반환 소송은 어떻게 하나요?',
    ],
  },
  {
    id: 'repair',
    label: '수리비 분쟁',
    title: '수리비 분쟁',
    description: '수리비 및 원상복구와 관련된 질문입니다.',
    questions: [
      '누수 수리비는 누가 부담하나요?',
      '도배 비용을 청구받았습니다.',
      '에어컨이 고장났는데 집주인이 안 고쳐줍니다.',
      '원상복구 범위는 어디까지인가요?',
    ],
  },
  {
    id: 'renewal',
    label: '계약 갱신 청구권',
    title: '계약 갱신 청구권',
    description: '계약 갱신과 관련된 자주 묻는 질문입니다.',
    questions: [
      '집주인이 실거주를 이유로 거절합니다.',
      '갱신청구권은 언제 행사해야 하나요?',
      '계약 갱신을 거절할 수 있나요?',
      '실거주가 거짓이면 어떻게 하나요?',
    ],
  },
  {
    id: 'termination',
    label: '해지 통보 시점',
    title: '해지 통보 시점',
    description: '계약 종료 및 해지 시점과 관련된 질문입니다.',
    questions: [
      '계약 만료 전에 언제 통보해야 하나요?',
      '묵시적 갱신은 언제 발생하나요?',
      '중도 해지가 가능한가요?',
      '이사 날짜는 어떻게 정해야 하나요?',
    ],
  },
]

/** 선택된 주제 id 로 Hero 내용을 찾는다. 없으면 기본 화면. */
export function topicById(id: string | null): Topic {
  return TOPICS.find((topic) => topic.id === id) ?? DEFAULT_TOPIC
}
