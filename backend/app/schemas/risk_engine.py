from typing import Literal

from pydantic import BaseModel


class LessorAccount(BaseModel):
    holder: str | None = None
    bank: str | None = None
    number: str | None = None


class Contract(BaseModel):
    address: str | None = None
    building_name: str | None = None
    unit_no: str | None = None
    area_m2: float | None = None
    lessor_name: str | None = None
    lessor_birth: str | None = None
    lessee_name: str | None = None
    deposit: int | None = None
    deposit_hangul: int | None = None
    monthly_rent: int | None = None
    maintenance_fee: int | None = None
    down_payment: int | None = None
    balance: int | None = None
    balance_date: str | None = None
    contract_date: str | None = None
    term_start: str | None = None
    term_end: str | None = None
    handover_date: str | None = None
    agency_name: str | None = None
    agency_reg_no: str | None = None
    brokerage_fee: int | None = None
    lessor_account: LessorAccount
    has_seal_between_pages: bool | None = None
    has_corrections: bool | None = None


class ContractClause(BaseModel):
    no: int
    text: str | None
    is_handwritten: bool | None
    numbering_source: Literal["document", "assigned"]


class SpecialTerms(BaseModel):
    clauses: list[ContractClause]


class RegisteredLien(BaseModel):
    type: str | None = None
    max_amount: int | None = None
    holder: str | None = None
    set_date: str | None = None


class DisclosureMaintenance(BaseModel):
    is_fixed: bool | None = None
    amount: int | None = None
    items: list[str] | None = None


class DisclosureFacilityStatus(BaseModel):
    wall_floor: str | None = None
    water: str | None = None
    heating: str | None = None


class Disclosure(BaseModel):
    address: str | None = None
    unit_no: str | None = None
    area_m2: float | None = None
    lessor_name: str | None = None
    deposit: int | None = None
    liens: list[RegisteredLien]
    prior_deposits_total: int | None = None
    actual_rights_description: str | None = None
    prior_deposits_stated: bool | None = None
    maintenance: DisclosureMaintenance
    facility_status: DisclosureFacilityStatus
    brokerage_fee: int | None = None
    brokerage_fee_rate: float | None = None
    agency_reg_no: str | None = None
    broker_signed: bool | None = None
    written_date: str | None = None


class MutualAid(BaseModel):
    issuer: str | None = None
    coverage_amount: int | None = None
    valid_from: str | None = None
    valid_to: str | None = None
    agency_name: str | None = None
    agency_reg_no: str | None = None
    representative: str | None = None
    certificate_no: str | None = None


class RiskEngineInput(BaseModel):
    contract: Contract
    special_terms: SpecialTerms | None = None
    disclosure: Disclosure | None = None
    mutual_aid: MutualAid | None = None
    unknowns: list[str]
