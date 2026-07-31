import type { AnalysisJob, AnalysisJobDetail, AnalysisJobSummary } from '../types/analysis'
import type { Page } from '../types/api'
import { apiDelete, apiGet, apiPostForm, apiPut, type ApiOptions } from './client'

const BASE = '/api/v1/analyses'

/** 제목 입력 상한 — 백엔드 UpdateAnalysisTitleIn 과 동일. */
export const ANALYSIS_TITLE_MAX = 200

/**
 * 분석을 접수한다. **분석이 끝날 때까지 기다리지 않고** 202 + 작업 id 만 받는다.
 *
 * idempotencyKey 는 같은 요청의 재전송(더블클릭·네트워크 재시도)이 분석을 두 번 돌리지
 * 않게 한다 — 서버가 같은 키의 기존 작업을 그대로 돌려준다.
 *
 * options 는 채팅 첨부처럼 **화면이 실패를 직접 표현하는 자리**를 위한 것이다
 * (말풍선이 사유를 보여주므로 공통 오류 모달까지 뜨면 같은 말이 두 번 나온다).
 *
 * notify: false 는 채팅이 쓴다 — 대화 안에서 진행 상태와 결과를 그대로 보여주므로 알림까지
 * 쌓이면 같은 사실이 벨 배지·토스트로 두 번 전달된다. 완료·실패 알림은 백그라운드 워커가
 * 만들기 때문에 이 뜻은 접수 시점에 작업 행에 저장된다.
 */
export function startAnalysis(
  files: File[],
  idempotencyKey?: string,
  options?: ApiOptions & { notify?: boolean },
): Promise<AnalysisJob> {
  const { notify, ...apiOptions } = options ?? {}
  const form = new FormData()
  for (const file of files) {
    // FastAPI 의 list[UploadFile] 계약에 맞춰 같은 필드 이름을 반복한다.
    form.append('file', file)
  }
  // 생략하면 서버 기본값(true)이다 — 분석 화면은 지금처럼 알림을 받는다.
  if (notify === false) form.append('notify', 'false')
  return apiPostForm<AnalysisJob>(BASE, form, {
    ...apiOptions,
    headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
  })
}

/**
 * 작업 상태 + (끝났으면) 결과.
 *
 * silent 인 이유: 결과 화면이 폴링으로 반복 호출하므로, 일시적 실패마다 오류 모달이 뜨면
 * 화면을 덮어버린다. 화면이 <ErrorState /> 로 직접 표현한다.
 */
export function getAnalysis(jobId: string, silent = false): Promise<AnalysisJobDetail> {
  return apiGet<AnalysisJobDetail>(`${BASE}/${jobId}`, { silent })
}

export function listAnalyses(
  cursor?: string | null,
  limit = 20,
): Promise<Page<AnalysisJobSummary>> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set('cursor', cursor)
  return apiGet<Page<AnalysisJobSummary>>(`${BASE}?${params}`)
}

/**
 * 목록에 보이는 제목을 고친다.
 *
 * 제목은 산출물(analysis_result)에 있으므로 **결과가 없는 분석(진행 중·실패)은 409** 다.
 * 목록도 그 행에는 '제목 수정' 메뉴를 띄우지 않는다.
 */
export function updateAnalysisTitle(jobId: string, title: string): Promise<AnalysisJobSummary> {
  return apiPut<AnalysisJobSummary>(`${BASE}/${jobId}/title`, { title })
}

/** 분석 기록을 soft delete 한다 — 목록·상세에서 사라지고 서버에는 행이 남는다. */
export function deleteAnalysis(jobId: string): Promise<AnalysisJobSummary> {
  return apiDelete<AnalysisJobSummary>(`${BASE}/${jobId}`)
}
