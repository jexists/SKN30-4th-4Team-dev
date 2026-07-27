import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypeVar

from pydantic import BaseModel

from app.extraction.classifier import classify_pages, page_text
from app.extraction.normalizers import (
    normalize_account_number,
    normalize_area,
    normalize_birth,
    normalize_date,
    normalize_money,
    normalize_name,
    normalize_rate,
    normalize_registration_no,
    normalize_text,
    normalize_unit_no,
)
from app.extraction.schemas import (
    ActualRights,
    ContractDocument,
    DisclosureDocument,
    DisclosureFields,
    DocumentType,
    ExtractedField,
    ExtractionMethod,
    ExtractionMode,
    ExtractionResponse,
    FacilityStatus,
    FieldStatus,
    LeaseContractDocument,
    LeaseContractFields,
    LessorAccount,
    Maintenance,
    MutualAidDocument,
    MutualAidFields,
    OcrPage,
    RegisteredLien,
    RegisteredRights,
    SpecialClause,
    SpecialTermsDocument,
    SpecialTermsFields,
)
from app.extraction.types import RecognizedPage
from app.pipeline.contract_pipeline import ProcessingResult

PARSER_VERSION = "1.0.0"
Normalized = TypeVar("Normalized")

_DATE = r"\d{4}\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}\s*일?\.?"
_ARABIC_MONEY = r"(?:[₩￦]\s*)?\d[\d,\s]*(?:원(?:정)?)?"
_HANGUL_MONEY = r"(?:금\s*)?[영공일이삼사오육칠팔구십백천만억조]+원(?:정)?"
_NAME = r"[가-힣](?:\s*[가-힣]){1,5}"
_AREA = r"\d+(?:\.\d+)?\s*(?:㎡|m²|m2|평)"
_REGISTRATION = r"[A-Za-z0-9]{2,6}(?:\s*-\s*[A-Za-z0-9]{2,6}){1,4}"
_ACCOUNT = r"\d{2,6}(?:\s*[-–—]\s*\d{2,6}){1,4}"
_CIRCLED_NUMBERS = {
    "①": 1,
    "②": 2,
    "③": 3,
    "④": 4,
    "⑤": 5,
    "⑥": 6,
    "⑦": 7,
    "⑧": 8,
    "⑨": 9,
    "⑩": 10,
}


@dataclass(frozen=True)
class SourceLine:
    page: int
    width: int
    height: int
    text: str
    bbox: tuple[float, float, float, float]
    method: ExtractionMethod


def _union_bbox(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> tuple[float, float, float, float]:
    return (
        min(first[0], second[0]),
        min(first[1], second[1]),
        max(first[2], second[2]),
        max(first[3], second[3]),
    )


def _source_lines(pages: list[RecognizedPage]) -> list[SourceLine]:
    lines: list[SourceLine] = []
    for page in pages:
        ordered = sorted(
            page.parsed.regions,
            key=lambda region: (
                region.block_order if region.block_order is not None else 10_000,
                region.bbox[1],
                region.bbox[0],
            ),
        )
        for region in ordered:
            for text in region.text.splitlines():
                normalized = text.strip()
                if normalized:
                    lines.append(
                        SourceLine(
                            page=page.parsed.page_index + 1,
                            width=page.parsed.width,
                            height=page.parsed.height,
                            text=normalized,
                            bbox=region.bbox,
                            method=page.method,
                        )
                    )
    return lines


class RuleExtractor:
    def __init__(self, pages: list[RecognizedPage]):
        self.pages = pages
        self.lines = _source_lines(pages)
        if not self.lines:
            raise ValueError("추출할 OCR 텍스트가 없습니다.")

    @property
    def default_line(self) -> SourceLine:
        first_page = self.pages[0].parsed
        return SourceLine(
            page=first_page.page_index + 1,
            width=first_page.width,
            height=first_page.height,
            text="",
            bbox=(0.0, 0.0, float(first_page.width), float(first_page.height)),
            method=self.pages[0].method,
        )

    @staticmethod
    def _base_confidence(method: ExtractionMethod, adjacent: bool = False) -> float:
        if adjacent:
            return 0.82
        return 0.98 if method is ExtractionMethod.TEXT else 0.93

    def unreadable(
        self,
        *,
        method: ExtractionMethod | None = None,
        line: SourceLine | None = None,
    ) -> ExtractedField[Any]:
        source = line or self.default_line
        return ExtractedField(
            value=None,
            raw=source.text,
            status=FieldStatus.UNREADABLE,
            confidence=0.0,
            page=source.page,
            bbox=source.bbox,
            method=method or source.method,
        )

    def not_stated(self, line: SourceLine) -> ExtractedField[Any]:
        return ExtractedField(
            value=None,
            raw="",
            status=FieldStatus.NOT_STATED,
            confidence=self._base_confidence(line.method),
            page=line.page,
            bbox=line.bbox,
            method=line.method,
        )

    def from_raw(
        self,
        line: SourceLine,
        raw: str,
        normalizer: Callable[[str], Normalized],
        *,
        critical: bool = False,
        adjacent: bool = False,
        confidence_bonus: float = 0,
    ) -> ExtractedField[Normalized]:
        confidence = min(
            0.99,
            self._base_confidence(line.method, adjacent=adjacent) + confidence_bonus,
        )
        try:
            value = normalizer(raw)
        except (TypeError, ValueError):
            return ExtractedField(
                value=None,
                raw=raw,
                status=FieldStatus.UNREADABLE,
                confidence=0.65,
                page=line.page,
                bbox=line.bbox,
                method=line.method,
            )

        threshold = 0.90 if critical else 0.70
        status = FieldStatus.EXTRACTED if confidence >= threshold else FieldStatus.UNREADABLE
        return ExtractedField(
            value=value if status is FieldStatus.EXTRACTED else None,
            raw=raw,
            status=status,
            confidence=confidence,
            page=line.page,
            bbox=line.bbox,
            method=line.method,
        )

    def find(
        self,
        patterns: str | Iterable[str],
        normalizer: Callable[[str], Normalized],
        *,
        labels: str | Iterable[str] | None = None,
        critical: bool = False,
    ) -> ExtractedField[Normalized]:
        pattern_list = [patterns] if isinstance(patterns, str) else list(patterns)
        label_list: list[str] = []
        if isinstance(labels, str):
            label_list = [labels]
        elif labels is not None:
            label_list = list(labels)

        blank_line: SourceLine | None = None
        for line in self.lines:
            for label in label_list:
                if re.search(label, line.text, re.IGNORECASE):
                    blank_line = blank_line or line
            for pattern in pattern_list:
                match = re.search(pattern, line.text, re.IGNORECASE)
                if match:
                    raw = match.groupdict().get("value") or match.group(0)
                    return self.from_raw(
                        line,
                        raw.strip(),
                        normalizer,
                        critical=critical,
                    )

        for index, line in enumerate(self.lines[:-1]):
            following = self.lines[index + 1]
            if following.page != line.page:
                continue
            candidate = f"{line.text}\n{following.text}"
            source = SourceLine(
                page=line.page,
                width=line.width,
                height=line.height,
                text=candidate,
                bbox=_union_bbox(line.bbox, following.bbox),
                method=line.method,
            )
            for pattern in pattern_list:
                match = re.search(pattern, candidate, re.IGNORECASE)
                if match:
                    raw = match.groupdict().get("value") or match.group(0)
                    return self.from_raw(
                        source,
                        raw.strip(),
                        normalizer,
                        critical=critical,
                        adjacent=True,
                    )

        if blank_line is not None:
            return self.not_stated(blank_line)
        return self.unreadable()

    def line_containing(self, pattern: str) -> SourceLine | None:
        return next(
            (line for line in self.lines if re.search(pattern, line.text, re.IGNORECASE)),
            None,
        )


def _vision_field(extractor: RuleExtractor) -> ExtractedField[bool]:
    return extractor.unreadable(method=ExtractionMethod.VISION)


def _lease_fields(pages: list[RecognizedPage]) -> LeaseContractFields:
    ex = RuleExtractor(pages)
    deposit = ex.find(
        rf"(?:보증금|전세금)[^\n\d₩￦]*(?P<value>{_ARABIC_MONEY})",
        normalize_money,
        labels=r"보증금|전세금",
        critical=True,
    )
    deposit_hangul = ex.find(
        rf"(?:보증금|전세금)[^\n영공일이삼사오육칠팔구십백천만억조]*(?P<value>{_HANGUL_MONEY})",
        normalize_money,
        labels=r"보증금|전세금",
        critical=True,
    )
    if (
        deposit.status is FieldStatus.EXTRACTED
        and deposit_hangul.status is FieldStatus.EXTRACTED
        and deposit.value == deposit_hangul.value
    ):
        boosted = min(0.99, max(deposit.confidence, deposit_hangul.confidence) + 0.03)
        deposit = deposit.model_copy(update={"confidence": boosted})
        deposit_hangul = deposit_hangul.model_copy(update={"confidence": boosted})

    term_start = ex.find(
        rf"(?:임대차\s*기간|계약\s*기간)[^\n]*(?P<value>{_DATE})\s*(?:부터|~|-)",
        normalize_date,
        labels=r"임대차\s*기간|계약\s*기간",
    )
    term_end = ex.find(
        rf"(?:임대차\s*기간|계약\s*기간)[^\n]*(?:부터|~|-)[^\n]*(?P<value>{_DATE})\s*(?:까지)?",
        normalize_date,
        labels=r"임대차\s*기간|계약\s*기간",
    )

    return LeaseContractFields(
        address=ex.find(
            r"(?:소재지|주소)\s*[:：]?\s*(?P<value>[^\n]{5,})",
            normalize_text,
            labels=r"소재지|주소",
        ),
        building_name=ex.find(
            r"(?:건물명|건물\s*명칭)\s*[:：]?\s*(?P<value>[^\n,|]{2,30})",
            normalize_text,
            labels=r"건물명|건물\s*명칭",
        ),
        unit_no=ex.find(
            r"(?:동\s*[·/]?\s*호수|호수)\s*[:：]?\s*(?P<value>제?\s*[A-Za-z0-9]+\s*호?)",
            normalize_unit_no,
            labels=r"동\s*[·/]?\s*호수|호수",
        ),
        area_m2=ex.find(
            rf"(?:전용\s*면적|면적)\s*[:：]?\s*(?P<value>{_AREA})",
            normalize_area,
            labels=r"전용\s*면적|면적",
        ),
        lessor_name=ex.find(
            rf"임대인(?:\s*성명)?\s*[:：]?\s*(?P<value>{_NAME})",
            normalize_name,
            labels=r"임대인",
            critical=True,
        ),
        lessor_birth=ex.find(
            [
                rf"임대인[^\n]*(?:생년월일|주민등록번호)\s*[:：]?\s*(?P<value>{_DATE})",
                r"임대인[^\n]*(?:생년월일|주민등록번호)\s*[:：]?\s*(?P<value>\d{6}\s*[-–—]?\s*[1-8])",
            ],
            normalize_birth,
            labels=r"임대인[^\n]*(?:생년월일|주민등록번호)",
            critical=True,
        ),
        lessee_name=ex.find(
            rf"임차인(?:\s*성명)?\s*[:：]?\s*(?P<value>{_NAME})",
            normalize_name,
            labels=r"임차인",
            critical=True,
        ),
        deposit=deposit,
        deposit_hangul=deposit_hangul,
        monthly_rent=ex.find(
            rf"(?:월세|차임)\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"월세|차임",
            critical=True,
        ),
        maintenance_fee=ex.find(
            rf"관리비\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"관리비",
            critical=True,
        ),
        down_payment=ex.find(
            rf"계약금\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"계약금",
            critical=True,
        ),
        balance=ex.find(
            rf"잔금\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"잔금",
            critical=True,
        ),
        balance_date=ex.find(
            rf"(?:잔금\s*(?:지급일|지급기일|일자)|잔금[^\n]*일)\s*[:：]?\s*(?P<value>{_DATE})",
            normalize_date,
            labels=r"잔금\s*(?:지급일|지급기일|일자)",
        ),
        contract_date=ex.find(
            rf"(?:계약일|계약\s*체결일)\s*[:：]?\s*(?P<value>{_DATE})",
            normalize_date,
            labels=r"계약일|계약\s*체결일",
        ),
        term_start=term_start,
        term_end=term_end,
        handover_date=ex.find(
            rf"(?:인도일|입주일)\s*[:：]?\s*(?P<value>{_DATE})",
            normalize_date,
            labels=r"인도일|입주일",
        ),
        agency_name=ex.find(
            r"(?:중개사무소|사무소명)\s*[:：]?\s*(?P<value>[^\n,|]{2,40})",
            normalize_text,
            labels=r"중개사무소|사무소명",
        ),
        agency_reg_no=ex.find(
            rf"(?:중개사무소\s*)?등록번호\s*[:：]?\s*(?P<value>{_REGISTRATION})",
            normalize_registration_no,
            labels=r"등록번호",
            critical=True,
        ),
        brokerage_fee=ex.find(
            rf"(?:중개보수|중개수수료)\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"중개보수|중개수수료",
            critical=True,
        ),
        lessor_account=LessorAccount(
            holder=ex.find(
                rf"예금주\s*[:：]?\s*(?P<value>{_NAME})",
                normalize_name,
                labels=r"예금주",
                critical=True,
            ),
            bank=ex.find(
                r"(?:은행명|은행)\s*[:：]?\s*(?P<value>[가-힣A-Za-z]{2,20}(?:은행)?)",
                normalize_text,
                labels=r"은행명|은행",
            ),
            number=ex.find(
                rf"계좌번호\s*[:：]?\s*(?P<value>{_ACCOUNT})",
                normalize_account_number,
                labels=r"계좌번호",
                critical=True,
            ),
        ),
        has_seal_between_pages=_vision_field(ex),
        has_corrections=_vision_field(ex),
    )


def _special_terms_fields(pages: list[RecognizedPage]) -> SpecialTermsFields:
    ex = RuleExtractor(pages)
    clauses: list[SpecialClause] = []
    assigned = 1
    special_started = False

    for line in ex.lines:
        text = line.text.strip()
        if re.search(r"특약\s*(?:사항|조건)", text):
            special_started = True
            text = re.split(r"특약\s*(?:사항|조건)\s*[:：]?", text, maxsplit=1)[-1].strip()
            if not text:
                continue
        if not special_started:
            continue
        if re.search(r"(?:임대인|임차인|중개사)\s*(?:서명|날인)", text):
            continue

        match = re.match(r"^\s*(?:(\d+)[.)]|([①-⑩])|[-·])\s*(.+)$", text)
        if match:
            raw_number, circled, clause_text = match.groups()
            number = (
                int(raw_number)
                if raw_number
                else _CIRCLED_NUMBERS.get(circled or "", assigned)
            )
            source = "document"
        else:
            clause_text = text
            number = assigned
            source = "assigned"
        normalized = normalize_text(clause_text)
        if len(normalized) < 4:
            continue
        clauses.append(
            SpecialClause(
                no=number,
                text=ex.from_raw(line, clause_text, normalize_text),
                is_handwritten=None,
                numbering_source=source,
            )
        )
        assigned = max(assigned + 1, number + 1)

    if clauses:
        count_line = ex.line_containing(r"특약\s*(?:사항|조건)") or ex.lines[0]
        clause_count = ex.from_raw(count_line, str(len(clauses)), int)
    else:
        clause_count = ex.unreadable()

    return SpecialTermsFields(
        clauses=clauses,
        clause_count=clause_count,
        has_seal_on_page=_vision_field(ex),
    )


def _registered_rights(ex: RuleExtractor) -> RegisteredRights:
    section_line = ex.line_containing(r"등기(?:부)?상?\s*권리|소유권\s*외의\s*권리")
    liens: list[RegisteredLien] = []
    for line in ex.lines:
        right = re.search(r"(?P<value>근저당권|저당권|전세권|압류|가압류)", line.text)
        if not right:
            continue
        amount = re.search(rf"(?P<value>{_ARABIC_MONEY})", line.text[right.end() :])
        holder = re.search(
            r"(?:권리자|채권자|근저당권자)?\s*[:：]?\s*([가-힣A-Za-z0-9]{2,20})",
            line.text,
        )
        set_date = re.search(_DATE, line.text)
        liens.append(
            RegisteredLien(
                type=ex.from_raw(line, right.group("value"), normalize_text),
                max_amount=(
                    ex.from_raw(line, amount.group("value"), normalize_money, critical=True)
                    if amount
                    else ex.unreadable(line=line)
                ),
                holder=(
                    ex.from_raw(line, holder.group(1), normalize_text, critical=True)
                    if holder
                    else ex.unreadable(line=line)
                ),
                set_date=(
                    ex.from_raw(line, set_date.group(0), normalize_date)
                    if set_date
                    else ex.unreadable(line=line)
                ),
            )
        )

    if liens:
        status = FieldStatus.EXTRACTED
    elif section_line:
        status = FieldStatus.NOT_STATED
    else:
        status = FieldStatus.UNREADABLE
    return RegisteredRights(liens=liens, section_status=status)


def _actual_rights(ex: RuleExtractor) -> ActualRights:
    line = ex.line_containing(r"실제\s*권리관계")
    if line is None:
        return ActualRights(
            prior_deposits_total=ex.unreadable(),
            description=ex.unreadable(),
            section_status=FieldStatus.UNREADABLE,
        )

    remainder = re.sub(r".*실제\s*권리관계\s*[:：]?", "", line.text).strip()
    if not remainder:
        empty = ex.not_stated(line)
        return ActualRights(
            prior_deposits_total=empty,
            description=empty,
            section_status=FieldStatus.NOT_STATED,
        )

    amount = re.search(_ARABIC_MONEY, remainder)
    return ActualRights(
        prior_deposits_total=(
            ex.from_raw(line, amount.group(0), normalize_money, critical=True)
            if amount
            else ex.not_stated(line)
        ),
        description=ex.from_raw(line, remainder, normalize_text),
        section_status=FieldStatus.EXTRACTED,
    )


def _disclosure_fields(pages: list[RecognizedPage]) -> DisclosureFields:
    ex = RuleExtractor(pages)
    maintenance_amount = ex.find(
        rf"관리비\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
        normalize_money,
        labels=r"관리비",
        critical=True,
    )
    maintenance_line = ex.line_containing(r"관리비")
    if maintenance_line and maintenance_amount.status is FieldStatus.EXTRACTED:
        is_fixed = ex.from_raw(maintenance_line, "true", lambda _raw: True)
    elif maintenance_line:
        is_fixed = ex.not_stated(maintenance_line)
    else:
        is_fixed = ex.unreadable()

    items = ex.find(
        r"(?:관리비\s*)?(?:포함\s*항목|항목)\s*[:：]?\s*(?P<value>[^\n]+)",
        lambda raw: [item.strip() for item in re.split(r"[,·/]", raw) if item.strip()],
        labels=r"포함\s*항목",
    )
    facility_line = ex.line_containing(r"시설\s*상태|벽면|바닥|급수|난방")

    return DisclosureFields(
        address=ex.find(
            r"(?:소재지|주소)\s*[:：]?\s*(?P<value>[^\n]{5,})",
            normalize_text,
            labels=r"소재지|주소",
        ),
        unit_no=ex.find(
            r"(?:동\s*[·/]?\s*호수|호수)\s*[:：]?\s*(?P<value>제?\s*[A-Za-z0-9]+\s*호?)",
            normalize_unit_no,
            labels=r"동\s*[·/]?\s*호수|호수",
        ),
        area_m2=ex.find(
            rf"(?:전용\s*면적|면적)\s*[:：]?\s*(?P<value>{_AREA})",
            normalize_area,
            labels=r"전용\s*면적|면적",
        ),
        lessor_name=ex.find(
            rf"임대인(?:\s*성명)?\s*[:：]?\s*(?P<value>{_NAME})",
            normalize_name,
            labels=r"임대인",
            critical=True,
        ),
        deposit=ex.find(
            rf"(?:보증금|전세금)[^\n\d₩￦]*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"보증금|전세금",
            critical=True,
        ),
        registered_rights=_registered_rights(ex),
        actual_rights=_actual_rights(ex),
        maintenance=Maintenance(
            is_fixed=is_fixed,
            amount=maintenance_amount,
            items=items,
        ),
        facility_status=FacilityStatus(
            section_status=(
                FieldStatus.EXTRACTED if facility_line else FieldStatus.UNREADABLE
            ),
            wall_floor=ex.find(
                r"(?:벽면|바닥|벽·바닥)\s*[:：]?\s*(?P<value>[^\n,|]{1,20})",
                normalize_text,
                labels=r"벽면|바닥|벽·바닥",
            ),
            water=ex.find(
                r"(?:급수|수도)\s*[:：]?\s*(?P<value>[^\n,|]{1,20})",
                normalize_text,
                labels=r"급수|수도",
            ),
            heating=ex.find(
                r"난방\s*[:：]?\s*(?P<value>[^\n,|]{1,30})",
                normalize_text,
                labels=r"난방",
            ),
        ),
        brokerage_fee=ex.find(
            rf"(?:중개보수|중개수수료)\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"중개보수|중개수수료",
            critical=True,
        ),
        brokerage_fee_rate=ex.find(
            r"(?:중개보수\s*요율|요율)\s*[:：]?\s*(?P<value>\d+(?:\.\d+)?\s*%)",
            normalize_rate,
            labels=r"중개보수\s*요율|요율",
        ),
        agency_reg_no=ex.find(
            rf"(?:중개사무소\s*)?등록번호\s*[:：]?\s*(?P<value>{_REGISTRATION})",
            normalize_registration_no,
            labels=r"등록번호",
            critical=True,
        ),
        broker_signed=_vision_field(ex),
        written_date=ex.find(
            rf"(?:작성일|확인\s*설명일)\s*[:：]?\s*(?P<value>{_DATE})",
            normalize_date,
            labels=r"작성일|확인\s*설명일",
        ),
    )


def _mutual_aid_fields(pages: list[RecognizedPage]) -> MutualAidFields:
    ex = RuleExtractor(pages)
    return MutualAidFields(
        issuer=ex.find(
            r"(?:발급기관|공제사업자)\s*[:：]?\s*(?P<value>[^\n,|]{2,40})",
            normalize_text,
            labels=r"발급기관|공제사업자",
        ),
        coverage_amount=ex.find(
            rf"(?:공제\s*금액|보장\s*금액)\s*[:：]?\s*(?P<value>{_ARABIC_MONEY})",
            normalize_money,
            labels=r"공제\s*금액|보장\s*금액",
            critical=True,
        ),
        valid_from=ex.find(
            rf"(?:유효기간|공제기간)[^\n]*(?P<value>{_DATE})\s*(?:부터|~|-)",
            normalize_date,
            labels=r"유효기간|공제기간",
        ),
        valid_to=ex.find(
            rf"(?:유효기간|공제기간)[^\n]*(?:부터|~|-)[^\n]*(?P<value>{_DATE})",
            normalize_date,
            labels=r"유효기간|공제기간",
        ),
        agency_name=ex.find(
            r"(?:중개사무소|사무소명)\s*[:：]?\s*(?P<value>[^\n,|]{2,40})",
            normalize_text,
            labels=r"중개사무소|사무소명",
        ),
        agency_reg_no=ex.find(
            rf"(?:중개사무소\s*)?등록번호\s*[:：]?\s*(?P<value>{_REGISTRATION})",
            normalize_registration_no,
            labels=r"등록번호",
            critical=True,
        ),
        representative=ex.find(
            rf"(?:대표자|대표)\s*[:：]?\s*(?P<value>{_NAME})",
            normalize_name,
            labels=r"대표자|대표",
            critical=True,
        ),
        certificate_no=ex.find(
            r"(?:증서번호|공제증서번호)\s*[:：]?\s*(?P<value>제?\s*[A-Za-z0-9-]+\s*호?)",
            normalize_text,
            labels=r"증서번호|공제증서번호",
        ),
    )


def _field_confidences(value: Any) -> list[float]:
    if isinstance(value, ExtractedField):
        return [value.confidence]
    if isinstance(value, BaseModel):
        return [
            confidence
            for field_name in type(value).model_fields
            for confidence in _field_confidences(getattr(value, field_name))
        ]
    if isinstance(value, list):
        return [confidence for item in value for confidence in _field_confidences(item)]
    return []


def _envelope_values(
    source_file: str,
    pages: list[RecognizedPage],
    fields: Any,
) -> dict[str, Any]:
    confidences = _field_confidences(fields)
    unreadable_count = sum(
        1
        for value in _walk_fields(fields)
        if value.status is FieldStatus.UNREADABLE
    )
    return {
        "source_file": source_file,
        "page_count": len({page.parsed.page_index for page in pages}),
        "parsed_at": datetime.now().astimezone(),
        "parser_version": PARSER_VERSION,
        "overall_confidence": (
            round(sum(confidences) / len(confidences), 4) if confidences else 0.0
        ),
        "warnings": (
            [f"확인하지 못한 필드가 {unreadable_count}개 있습니다."] if unreadable_count else []
        ),
    }


def _walk_fields(value: Any) -> Iterable[ExtractedField[Any]]:
    if isinstance(value, ExtractedField):
        yield value
    elif isinstance(value, BaseModel):
        for field_name in type(value).model_fields:
            yield from _walk_fields(getattr(value, field_name))
    elif isinstance(value, list):
        for item in value:
            yield from _walk_fields(item)


def _documents(
    pages: list[RecognizedPage],
    source_file: str,
) -> tuple[list[ContractDocument], list[DocumentType]]:
    grouped = classify_pages(pages)
    if not grouped[DocumentType.LEASE_CONTRACT]:
        raise ValueError("임대차계약서 페이지를 찾을 수 없습니다.")

    documents: list[ContractDocument] = []
    builders: list[tuple[DocumentType, Callable[[list[RecognizedPage]], Any], type[Any]]] = [
        (DocumentType.LEASE_CONTRACT, _lease_fields, LeaseContractDocument),
        (DocumentType.SPECIAL_TERMS, _special_terms_fields, SpecialTermsDocument),
        (DocumentType.DISCLOSURE, _disclosure_fields, DisclosureDocument),
        (DocumentType.MUTUAL_AID, _mutual_aid_fields, MutualAidDocument),
    ]
    missing: list[DocumentType] = []
    for doc_type, builder, document_class in builders:
        doc_pages = grouped[doc_type]
        if not doc_pages:
            missing.append(doc_type)
            continue
        fields = builder(doc_pages)
        documents.append(
            document_class(
                **_envelope_values(source_file, doc_pages, fields),
                fields=fields,
            )
        )
    return documents, missing


def build_extraction_response(
    result: ProcessingResult,
    source_file: str,
    mode: ExtractionMode,
) -> ExtractionResponse:
    ocr_pages = [
        OcrPage(
            page=page.parsed.page_index + 1,
            width=page.parsed.width,
            height=page.parsed.height,
            text=page_text(page),
            method=page.method,
        )
        for page in result.recognized_pages
    ]
    documents: list[ContractDocument] = []
    missing: list[DocumentType] = []
    warnings: list[str] = []

    if mode is ExtractionMode.CONTRACT_BUNDLE:
        documents, missing = _documents(result.recognized_pages, source_file)
        if missing:
            warnings.append(
                "찾지 못한 문서: " + ", ".join(doc_type.value for doc_type in missing)
            )

    structured_review_required = any(
        field.status is not FieldStatus.EXTRACTED or field.confidence < 0.90
        for document in documents
        for field in _walk_fields(document.fields)
    )

    return ExtractionResponse(
        mode=mode,
        source_file=source_file,
        page_count=len(ocr_pages),
        mask_count=result.mask_count,
        coarse_mask_count=result.coarse_mask_count,
        review_required=(
            result.review_required or bool(missing) or structured_review_required
        ),
        ocr_pages=ocr_pages,
        documents=documents,
        missing_doc_types=missing,
        warnings=warnings,
    )
