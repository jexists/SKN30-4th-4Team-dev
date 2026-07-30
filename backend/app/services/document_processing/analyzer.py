import logging
import re
from typing import Literal

from app.core.config import settings
from app.core.exceptions import AppError
from app.schemas.document import (
    ContractLlmAnalysis,
    ContractRiskIssue,
    ContractTerms,
)

logger = logging.getLogger(__name__)

# 차임 칸이 "비어 있다"고 말하는 표현들. 서식마다 문구가 달라 넉넉하게 잡는다.
_NO_RENT = re.compile(r"없음|없다|해당\s*없|미해당|^무$|^[-–—/]+$|^0+\s*원?$")

SYSTEM_PROMPT = """당신은 주택 임대차 관련 서류를 종합 검토하는 분석 도우미입니다.
입력은 개인정보가 플레이스홀더로 치환된 하나 이상의 OCR 문서입니다.

규칙:
1. 플레이스홀더의 원래 값을 추측하거나 복원하지 마세요.
2. 문서에 명시된 금액, 기간, 목적물 소재지, 주택 유형, 권리관계와 특약만 추출하세요.
3. 위험 항목은 입력 문서의 문구를 근거로 설명하세요.
   문서끼리 내용이 다르거나 불확실하면 단정하지 마세요.
4. 법률 자문처럼 확정적으로 표현하지 말고 확인이 필요한 사항을 명시하세요.
5. 임대차 목적물의 소재지는 address 에 담고, 임대인·임차인의 성명·연락처 등
   당사자 신원 정보는 어떤 필드에도 포함하지 마세요.
6. contract_type 은 계약서 문구를 근거로 "전세" 또는 "월세" 중 하나만 씁니다.
   매월 지급하는 차임이 없거나 0원이면 전세, 차임이 있으면 월세입니다
   (보증금이 큰 반전세도 월세로 봅니다). 판단할 근거가 없으면 비워 두세요.
"""


def _contract_type_from_rent(monthly_rent: str | None) -> Literal["전세", "월세"]:
    """차임 원문으로 전세/월세를 가른다 — LLM 없이 도는 로컬 폴백용.

    금액이 "금 오십만원정"처럼 한글로만 적힌 계약서가 흔하다. 그래서 숫자 유무로
    판단하지 않고, **비었다고 말하는 표현이면 전세, 무슨 값이든 적혀 있으면 월세**로 본다.
    프론트의 `contractTypeOf` 폴백과 같은 규칙이다(둘 다 손보려면 같이 손봐야 한다).
    """
    text = (monthly_rent or "").strip()
    if not text:
        return "전세"
    return "전세" if _NO_RENT.search(text) else "월세"


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

    @staticmethod
    def _field_after_label(text: str, *labels: str) -> str | None:
        alternatives = "|".join(re.escape(label) for label in labels)
        match = re.search(rf"(?:{alternatives})\s*[:：]?\s*([^\n]{{1,40}})", text)
        return match.group(1).strip(" ,") if match else None

    @staticmethod
    def _analyze_locally(text: str) -> ContractLlmAnalysis:
        """API 키가 없는 로컬 시연용 보수적 규칙 분석.

        법률 판단을 대신하지 않고 화면 연결과 기본 계약 조건 확인에만 사용한다.
        """
        dates = re.findall(r"20\d{2}\s*[.년/-]\s*\d{1,2}\s*[.월/-]\s*\d{1,2}\s*일?", text)
        property_match = re.search(
            r"(아파트|오피스텔|연립주택|다세대주택|단독주택|다가구주택)", text
        )
        special_terms = [
            line.strip() for line in text.splitlines() if "특약" in line and len(line.strip()) > 2
        ][:10]
        monthly_rent = ContractAnalyzer._field_after_label(text, "월세", "차임")
        terms = ContractTerms(
            contract_type=_contract_type_from_rent(monthly_rent),
            deposit=ContractAnalyzer._field_after_label(text, "보증금", "임대차보증금"),
            monthly_rent=monthly_rent,
            contract_start=dates[0] if dates else None,
            contract_end=dates[1] if len(dates) > 1 else None,
            address=ContractAnalyzer._field_after_label(text, "소재지", "도로명주소", "주소"),
            property_type=property_match.group(1) if property_match else None,
            special_terms=special_terms,
        )

        risk_rules = [
            (
                "HIGH",
                "권리 제한 또는 담보 설정 확인",
                r"근저당|담보권|압류|가압류|신탁",
                "계약서에 담보·압류·신탁 관련 문구가 있습니다. "
                "실제 등기부등본과 일치하는지 확인해야 합니다.",
                "최신 등기부등본의 선순위 권리와 소유자가 다른 제출 서류와 일치하는지 확인하세요.",
            ),
            (
                "MEDIUM",
                "임차인 수선 책임 확인",
                r"임차인[^\n]{0,30}(?:수리|수선|원상복구)|모든[^\n]{0,20}(?:책임|비용)",
                "수선 또는 비용 부담이 임차인에게 넓게 부과될 가능성이 있습니다.",
                "구조·주요 설비의 수선 책임 범위를 임대인과 명확히 나누세요.",
            ),
            (
                "MEDIUM",
                "해지·위약금 조항 확인",
                r"위약금|계약금[^\n]{0,20}몰취|일방[^\n]{0,20}해지",
                "계약 해지 시 부담이 커질 수 있는 위약 조항이 포함돼 있습니다.",
                "해지 사유, 통지 기간과 위약금 산정 기준을 계약 전에 확인하세요.",
            ),
            (
                "LOW",
                "대항력 보호 조항",
                r"전입신고|확정일자|보증보험",
                "임차인의 대항력 또는 보증금 보호와 관련된 문구가 확인됩니다.",
                "입주 후 전입신고와 확정일자를 실제로 완료하고 보증보험 가능 여부를 확인하세요.",
            ),
        ]
        risks: list[ContractRiskIssue] = []
        for severity, title, pattern, reason, recommendation in risk_rules:
            match = re.search(pattern, text)
            if match:
                line_start = text.rfind("\n", 0, match.start()) + 1
                line_end = text.find("\n", match.end())
                clause = text[line_start : line_end if line_end >= 0 else len(text)].strip()
                risks.append(
                    ContractRiskIssue(
                        severity=severity,
                        title=title,
                        clause=clause[:240] or None,
                        reason=reason,
                        recommendation=recommendation,
                    )
                )

        missing: list[str] = []
        for label, value in (
            ("보증금", terms.deposit),
            ("계약 시작일", terms.contract_start),
            ("계약 종료일", terms.contract_end),
            ("주택 유형", terms.property_type),
        ):
            if not value:
                missing.append(label)
        summary = (
            f"로컬 규칙 분석에서 계약 조건을 추출하고 위험 확인 항목 {len(risks)}개를 찾았습니다. "
            "이 결과는 시연용 자동 점검이며 최신 등기부등본과 전문가 확인을 대체하지 않습니다."
        )
        return ContractLlmAnalysis(
            summary=summary,
            terms=terms,
            risks=risks,
            missing_information=missing,
        )

    def analyze(self, sanitized_text: str) -> ContractLlmAnalysis:
        text = sanitized_text.strip()
        if not text:
            raise AppError("계약서 분석 실패", "OCR로 인식된 계약서 내용이 없습니다.", 422)
        if len(text) > settings.CONTRACT_ANALYSIS_MAX_TOTAL_CHARS:
            raise AppError(
                "계약서 분석 실패",
                "인식된 계약서 내용이 분석 가능한 길이를 초과했습니다.",
                422,
            )

        if (
            self._model is None
            and not settings.OPENAI_API_KEY
            and settings.CONTRACT_ANALYSIS_LOCAL_FALLBACK
        ):
            return self._analyze_locally(text)

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
