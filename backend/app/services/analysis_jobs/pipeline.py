"""분석 파이프라인 — OCR·마스킹 → 종합 LLM 분석.

원래 routes/documents.py 안에 있던 로직을 **HTTP Request 에 의존하지 않도록** 뽑아낸 것이다.
이제 job_id 만 있으면 백그라운드 워커가 그대로 실행할 수 있다.
"""

import logging
import uuid
from collections.abc import Callable, Sequence

from app.core.config import settings
from app.core.exceptions import AppError
from app.models.analysis_job import JobStage, RiskLevel
from app.schemas.analysis import AnalysisDocumentOut, AnalysisResultOut
from app.schemas.document import OcrAnalysisResult
from app.services.analysis_jobs import storage as analysis_storage
from app.services.document_processing.analyzer import ContractAnalyzer
from app.services.document_processing.client import OcrWorkerClient

logger = logging.getLogger(__name__)

#: (stage, progress) 를 받는 콜백. 워커가 DB 에 진행률을 반영하는 데 쓴다.
StageCallback = Callable[[str, int], None]

# OCR 이 전체 시간의 대부분이라 진행률의 대부분(10~70%)을 여기에 배분한다.
_OCR_START = 10
_OCR_END = 70


def run_analysis(
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    file_names: Sequence[str],
    *,
    on_stage: StageCallback | None = None,
) -> AnalysisResultOut:
    """private Storage의 파일들을 OCR·마스킹한 뒤 한 번에 분석한다.

    오브젝트는 사용자/작업/순번 경로로 저장돼 있고 원본 이름은 file_names가 같은 순서로
    들고 있다. 어느 백엔드 워커가 작업을 잡아도 같은 원본을 내려받을 수 있다.

    실패는 전부 AppError 로 나간다 — `code` 가 5xx/429 면 워커가 재시도하고, 4xx 면 즉시
    실패로 닫는다(재시도해도 결과가 같은 사용자 입력 문제).
    """

    def notify(stage: JobStage, progress: int) -> None:
        if on_stage is not None:
            on_stage(stage.value, progress)

    worker = OcrWorkerClient()
    processed: list[tuple[str, OcrAnalysisResult]] = []
    total = len(file_names)

    notify(JobStage.OCR, _OCR_START)
    for index, filename in enumerate(file_names, start=1):
        content = analysis_storage.download_job_file(user_id, job_id, index - 1, filename)
        result = worker.process_for_analysis(filename, content)
        if not result.text_safe_for_analysis:
            raise AppError(
                "개인정보 검토 필요",
                f"{index}번째 서류에서 개인정보가 남아 있어 종합 분석을 중단했습니다.",
                422,
            )
        if len(result.sanitized_text) > settings.CONTRACT_ANALYSIS_MAX_CHARS:
            raise AppError(
                "서류 분석 실패",
                f"{index}번째 서류의 인식 내용이 분석 가능한 길이를 초과했습니다.",
                422,
            )
        processed.append((filename, result))
        notify(JobStage.OCR, _OCR_START + round((_OCR_END - _OCR_START) * index / max(total, 1)))

    combined_text = _combine(processed)
    if len(combined_text) > settings.CONTRACT_ANALYSIS_MAX_TOTAL_CHARS:
        raise AppError(
            "서류 분석 실패",
            "서류 전체의 인식 내용이 한 번에 분석 가능한 길이를 초과했습니다. "
            "서류 수를 줄여 다시 시도해 주세요.",
            422,
        )

    notify(JobStage.LLM, 80)
    analysis = ContractAnalyzer().analyze(combined_text)

    notify(JobStage.SAVING, 95)
    redaction_counts: dict[str, int] = {}
    for _, result in processed:
        for pii_type, count in result.redaction_counts.items():
            redaction_counts[pii_type] = redaction_counts.get(pii_type, 0) + count

    return AnalysisResultOut(
        sanitized_text=combined_text,
        redaction_counts=redaction_counts,
        redaction_scope=sorted(
            {pii_type for _, result in processed for pii_type in result.redaction_scope}
        ),
        mask_count=sum(result.mask_count for _, result in processed),
        coarse_mask_count=sum(result.coarse_mask_count for _, result in processed),
        review_required=any(result.review_required for _, result in processed),
        documents=[
            AnalysisDocumentOut(
                filename=filename,
                **result.model_dump(
                    exclude={
                        "text_safe_for_analysis",
                        "masked_pdf_media_type",
                        "masked_pdf_base64",
                    }
                ),
            )
            for filename, result in processed
        ],
        analysis=analysis,
    )


def _combine(processed: Sequence[tuple[str, OcrAnalysisResult]]) -> str:
    """여러 서류를 한 프롬프트로 합친다. 한 장이면 머리말 없이 그대로 쓴다."""
    if len(processed) == 1:
        return processed[0][1].sanitized_text
    return "\n\n".join(
        f"[문서 {index}]\n{result.sanitized_text.strip()}"
        for index, (_, result) in enumerate(processed, start=1)
    )


def summarize(result: AnalysisResultOut, file_names: Sequence[str]) -> tuple[str, str, str]:
    """목록 화면이 payload 를 읽지 않아도 되도록 (title, summary, risk_level) 을 미리 뽑는다."""
    severities = {risk.severity for risk in result.analysis.risks}
    if RiskLevel.HIGH.value in severities:
        risk_level = RiskLevel.HIGH.value
    elif RiskLevel.MEDIUM.value in severities:
        risk_level = RiskLevel.MEDIUM.value
    else:
        risk_level = RiskLevel.LOW.value

    title = result.analysis.terms.property_type or (file_names[0] if file_names else "분석 결과")
    return title, result.analysis.summary, risk_level
