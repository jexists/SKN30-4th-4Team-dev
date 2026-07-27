import logging

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import ContractLlmAnalysis

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """당신은 주택 임대차계약서를 검토하는 분석 도우미입니다.
입력은 개인정보가 플레이스홀더로 치환된 OCR 텍스트입니다.

규칙:
1. 플레이스홀더의 원래 값을 추측하거나 복원하지 마세요.
2. 문서에 명시된 금액, 기간, 주택 유형, 특약만 추출하세요.
3. 위험 항목은 계약서 문구를 근거로 설명하고 불확실하면 단정하지 마세요.
4. 법률 자문처럼 확정적으로 표현하지 말고 확인이 필요한 사항을 명시하세요.
5. 주소나 당사자 신원은 분석 결과에 포함하지 마세요.
"""


class ContractAnalyzer:
    def __init__(self, model=None):
        self._model = model

    def _get_model(self):
        if self._model is not None:
            return self._model
        if not settings.OPENAI_API_KEY:
            raise AppError(
                "계약서 분석 사용 불가",
                "계약서 분석 모델이 설정되지 않았습니다.",
                503,
            )
        from langchain_openai import ChatOpenAI

        self._model = ChatOpenAI(
            model=settings.CONTRACT_ANALYSIS_MODEL,
            temperature=0,
            timeout=60,
            max_retries=2,
            api_key=settings.OPENAI_API_KEY,
        )
        return self._model

    def analyze(self, sanitized_text: str) -> ContractLlmAnalysis:
        text = sanitized_text.strip()
        if not text:
            raise AppError("계약서 분석 실패", "OCR로 인식된 계약서 내용이 없습니다.", 422)
        if len(text) > settings.CONTRACT_ANALYSIS_MAX_CHARS:
            raise AppError(
                "계약서 분석 실패",
                "인식된 계약서 내용이 분석 가능한 길이를 초과했습니다.",
                422,
            )

        try:
            structured = self._get_model().with_structured_output(ContractLlmAnalysis)
            result = structured.invoke(
                [
                    ("system", SYSTEM_PROMPT),
                    ("human", f"다음 계약서를 분석하세요.\n\n{text}"),
                ]
            )
            return ContractLlmAnalysis.model_validate(result)
        except AppError:
            raise
        except Exception as exc:
            logger.exception("계약서 LLM 분석 실패")
            raise AppError(
                "계약서 분석 실패",
                "계약서 내용을 분석하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                502,
            ) from exc
