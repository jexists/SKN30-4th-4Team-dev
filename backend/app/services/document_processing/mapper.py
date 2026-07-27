from typing import Any

from app.schemas.document import OcrExtractionResponse, OcrWorkerDocument
from app.schemas.risk_engine import (
    Contract,
    ContractClause,
    Disclosure,
    DisclosureFacilityStatus,
    DisclosureMaintenance,
    LessorAccount,
    MutualAid,
    RegisteredLien,
    RiskEngineInput,
    SpecialTerms,
)


def _path(data: dict[str, Any], path: str) -> Any:
    value: Any = data
    for part in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _field_value(
    fields: dict[str, Any],
    path: str,
    unknowns: list[str],
) -> Any:
    field = _path(fields, path)
    if not isinstance(field, dict) or field.get("status") != "extracted":
        unknowns.append(path)
        return None
    return field.get("value")


def _document(
    extraction: OcrExtractionResponse,
    doc_type: str,
) -> OcrWorkerDocument | None:
    return next(
        (document for document in extraction.documents if document.doc_type == doc_type),
        None,
    )


def _contract(document: OcrWorkerDocument, unknowns: list[str]) -> Contract:
    fields = document.fields
    values = {
        name: _field_value(fields, name, unknowns)
        for name in (
            "address",
            "building_name",
            "unit_no",
            "area_m2",
            "lessor_name",
            "lessor_birth",
            "lessee_name",
            "deposit",
            "deposit_hangul",
            "monthly_rent",
            "maintenance_fee",
            "down_payment",
            "balance",
            "balance_date",
            "contract_date",
            "term_start",
            "term_end",
            "handover_date",
            "agency_name",
            "agency_reg_no",
            "brokerage_fee",
            "has_seal_between_pages",
            "has_corrections",
        )
    }
    values["lessor_account"] = LessorAccount(
        holder=_field_value(fields, "lessor_account.holder", unknowns),
        bank=_field_value(fields, "lessor_account.bank", unknowns),
        number=_field_value(fields, "lessor_account.number", unknowns),
    )
    return Contract.model_validate(values)


def _special_terms(
    document: OcrWorkerDocument | None,
    unknowns: list[str],
) -> SpecialTerms | None:
    if document is None:
        unknowns.append("special_terms")
        return None

    clauses: list[ContractClause] = []
    for index, clause in enumerate(document.fields.get("clauses") or []):
        text = clause.get("text") if isinstance(clause, dict) else None
        path = f"special_terms.clauses[{index}].text"
        if not isinstance(text, dict) or text.get("status") != "extracted":
            unknowns.append(path)
            value = None
        else:
            value = text.get("value")
        clauses.append(
            ContractClause(
                no=int(clause.get("no", index + 1)),
                text=value,
                is_handwritten=clause.get("is_handwritten"),
                numbering_source=clause.get("numbering_source", "assigned"),
            )
        )
    return SpecialTerms(clauses=clauses)


def _disclosure(
    document: OcrWorkerDocument | None,
    unknowns: list[str],
) -> Disclosure | None:
    if document is None:
        unknowns.append("disclosure")
        return None

    fields = document.fields
    rights = fields.get("registered_rights") or {}
    liens: list[RegisteredLien] = []
    for index, lien in enumerate(rights.get("liens") or []):
        liens.append(
            RegisteredLien(
                type=_field_value(lien, "type", unknowns),
                max_amount=_field_value(lien, "max_amount", unknowns),
                holder=_field_value(lien, "holder", unknowns),
                set_date=_field_value(lien, "set_date", unknowns),
            )
        )
        if any(value is None for value in liens[-1].model_dump().values()):
            unknowns.append(f"disclosure.registered_rights.liens[{index}]")

    actual = fields.get("actual_rights") or {}
    actual_status = actual.get("section_status")
    if actual_status == "not_stated":
        prior_deposits_stated: bool | None = False
    elif actual_status == "extracted":
        prior_deposits_stated = True
    else:
        prior_deposits_stated = None
        unknowns.append("disclosure.actual_rights.section_status")

    return Disclosure(
        address=_field_value(fields, "address", unknowns),
        unit_no=_field_value(fields, "unit_no", unknowns),
        area_m2=_field_value(fields, "area_m2", unknowns),
        lessor_name=_field_value(fields, "lessor_name", unknowns),
        deposit=_field_value(fields, "deposit", unknowns),
        liens=liens,
        prior_deposits_total=_field_value(fields, "actual_rights.prior_deposits_total", unknowns),
        actual_rights_description=_field_value(fields, "actual_rights.description", unknowns),
        prior_deposits_stated=prior_deposits_stated,
        maintenance=DisclosureMaintenance(
            is_fixed=_field_value(fields, "maintenance.is_fixed", unknowns),
            amount=_field_value(fields, "maintenance.amount", unknowns),
            items=_field_value(fields, "maintenance.items", unknowns),
        ),
        facility_status=DisclosureFacilityStatus(
            wall_floor=_field_value(fields, "facility_status.wall_floor", unknowns),
            water=_field_value(fields, "facility_status.water", unknowns),
            heating=_field_value(fields, "facility_status.heating", unknowns),
        ),
        brokerage_fee=_field_value(fields, "brokerage_fee", unknowns),
        brokerage_fee_rate=_field_value(fields, "brokerage_fee_rate", unknowns),
        agency_reg_no=_field_value(fields, "agency_reg_no", unknowns),
        broker_signed=_field_value(fields, "broker_signed", unknowns),
        written_date=_field_value(fields, "written_date", unknowns),
    )


def _mutual_aid(
    document: OcrWorkerDocument | None,
    unknowns: list[str],
) -> MutualAid | None:
    if document is None:
        unknowns.append("mutual_aid")
        return None

    fields = document.fields
    return MutualAid(
        **{
            name: _field_value(fields, name, unknowns)
            for name in (
                "issuer",
                "coverage_amount",
                "valid_from",
                "valid_to",
                "agency_name",
                "agency_reg_no",
                "representative",
                "certificate_no",
            )
        }
    )


def map_to_risk_engine(extraction: OcrExtractionResponse) -> RiskEngineInput:
    unknowns: list[str] = []
    lease = _document(extraction, "lease_contract")
    if lease is None:
        raise ValueError("임대차계약서 추출 결과가 없습니다.")

    result = RiskEngineInput(
        contract=_contract(lease, unknowns),
        special_terms=_special_terms(_document(extraction, "special_terms"), unknowns),
        disclosure=_disclosure(_document(extraction, "disclosure"), unknowns),
        mutual_aid=_mutual_aid(_document(extraction, "mutual_aid"), unknowns),
        unknowns=[],
    )
    return result.model_copy(update={"unknowns": list(dict.fromkeys(unknowns))})
