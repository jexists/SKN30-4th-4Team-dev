"""분석 작업·산출물 API 입출력.

DB 모델은 models/analysis_job.py. 여기에는 **마스킹 PDF 가 없다** — 원본을 보관하지 않기로
했고(용량), 리포트는 프론트가 브라우저 인쇄로 PDF 를 만든다.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.document import ContractLlmAnalysis


class AnalysisDocumentOut(BaseModel):
    """서류 한 장의 OCR·마스킹 결과."""

    filename: str
    sanitized_text: str
    redaction_counts: dict[str, int]
    redaction_scope: list[str]
    mask_count: int
    coarse_mask_count: int
    review_required: bool


class AnalysisResultOut(BaseModel):
    """서류 여러 장을 합친 종합 분석 결과. analysis_result.payload 에 그대로 저장된다."""

    sanitized_text: str
    redaction_counts: dict[str, int]
    redaction_scope: list[str]
    mask_count: int
    coarse_mask_count: int
    review_required: bool
    documents: list[AnalysisDocumentOut] = Field(default_factory=list)
    analysis: ContractLlmAnalysis


class AnalysisErrorOut(BaseModel):
    """실패 사유. message 는 그대로 사용자에게 보이는 한국어다."""

    code: str | None = None
    message: str


class AnalysisJobOut(BaseModel):
    """POST /analyses 의 202 응답 — 접수됐다는 사실과 추적용 id 만."""

    id: uuid.UUID
    status: str
    created_at: datetime


class AnalysisJobSummaryOut(BaseModel):
    """목록용. payload(수십 KB)를 읽지 않고 analysis_result 의 요약 컬럼만 조인한다."""

    id: uuid.UUID
    status: str
    stage: str | None = None
    progress: int = 0
    file_names: list[str] = Field(default_factory=list)
    title: str | None = None
    risk_level: str | None = None
    created_at: datetime
    finished_at: datetime | None = None


class AnalysisJobDetailOut(AnalysisJobSummaryOut):
    """상세. 진행 중이면 result 가 비어 있고, SUCCEEDED 면 채워진다.

    결과를 별도 엔드포인트로 빼지 않은 이유: 프론트가 상태를 폴링하다가 SUCCEEDED 를 본
    바로 그 응답에 결과가 들어 있어야 화면이 한 번에 그려진다(왕복 1회 절약).
    """

    summary: str | None = None
    attempt_count: int = 0
    result: AnalysisResultOut | None = None
    error: AnalysisErrorOut | None = None
