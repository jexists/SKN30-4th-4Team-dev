from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field

BBox = tuple[float, float, float, float]


class FieldStatus(StrEnum):
    EXTRACTED = "extracted"
    NOT_STATED = "not_stated"
    UNREADABLE = "unreadable"


class ExtractionMethod(StrEnum):
    TEXT = "text"
    OCR = "ocr"
    VISION = "vision"


class DocumentType(StrEnum):
    LEASE_CONTRACT = "lease_contract"
    SPECIAL_TERMS = "special_terms"
    DISCLOSURE = "disclosure"
    MUTUAL_AID = "mutual_aid"


class ExtractionMode(StrEnum):
    CONTRACT_BUNDLE = "contract_bundle"
    REGISTRY = "registry"


class ExtractedField[FieldValue](BaseModel):
    value: FieldValue | None
    raw: str
    status: FieldStatus
    confidence: float = Field(ge=0, le=1)
    page: int = Field(ge=1)
    bbox: BBox
    method: ExtractionMethod


class LessorAccount(BaseModel):
    holder: ExtractedField[str]
    bank: ExtractedField[str]
    number: ExtractedField[str]


class LeaseContractFields(BaseModel):
    address: ExtractedField[str]
    building_name: ExtractedField[str]
    unit_no: ExtractedField[str]
    area_m2: ExtractedField[float]
    lessor_name: ExtractedField[str]
    lessor_birth: ExtractedField[str]
    lessee_name: ExtractedField[str]
    deposit: ExtractedField[int]
    deposit_hangul: ExtractedField[int]
    monthly_rent: ExtractedField[int]
    maintenance_fee: ExtractedField[int]
    down_payment: ExtractedField[int]
    balance: ExtractedField[int]
    balance_date: ExtractedField[str]
    contract_date: ExtractedField[str]
    term_start: ExtractedField[str]
    term_end: ExtractedField[str]
    handover_date: ExtractedField[str]
    agency_name: ExtractedField[str]
    agency_reg_no: ExtractedField[str]
    brokerage_fee: ExtractedField[int]
    lessor_account: LessorAccount
    has_seal_between_pages: ExtractedField[bool]
    has_corrections: ExtractedField[bool]


class SpecialClause(BaseModel):
    no: int
    text: ExtractedField[str]
    is_handwritten: bool | None
    numbering_source: Literal["document", "assigned"]


class SpecialTermsFields(BaseModel):
    clauses: list[SpecialClause]
    clause_count: ExtractedField[int]
    has_seal_on_page: ExtractedField[bool]


class RegisteredLien(BaseModel):
    type: ExtractedField[str]
    max_amount: ExtractedField[int]
    holder: ExtractedField[str]
    set_date: ExtractedField[str]


class RegisteredRights(BaseModel):
    liens: list[RegisteredLien]
    section_status: FieldStatus


class ActualRights(BaseModel):
    prior_deposits_total: ExtractedField[int]
    description: ExtractedField[str]
    section_status: FieldStatus


class Maintenance(BaseModel):
    is_fixed: ExtractedField[bool]
    amount: ExtractedField[int]
    items: ExtractedField[list[str]]


class FacilityStatus(BaseModel):
    section_status: FieldStatus
    wall_floor: ExtractedField[str]
    water: ExtractedField[str]
    heating: ExtractedField[str]


class DisclosureFields(BaseModel):
    address: ExtractedField[str]
    unit_no: ExtractedField[str]
    area_m2: ExtractedField[float]
    lessor_name: ExtractedField[str]
    deposit: ExtractedField[int]
    registered_rights: RegisteredRights
    actual_rights: ActualRights
    maintenance: Maintenance
    facility_status: FacilityStatus
    brokerage_fee: ExtractedField[int]
    brokerage_fee_rate: ExtractedField[float]
    agency_reg_no: ExtractedField[str]
    broker_signed: ExtractedField[bool]
    written_date: ExtractedField[str]


class MutualAidFields(BaseModel):
    issuer: ExtractedField[str]
    coverage_amount: ExtractedField[int]
    valid_from: ExtractedField[str]
    valid_to: ExtractedField[str]
    agency_name: ExtractedField[str]
    agency_reg_no: ExtractedField[str]
    representative: ExtractedField[str]
    certificate_no: ExtractedField[str]


class DocumentEnvelopeBase(BaseModel):
    source_file: str
    page_count: int = Field(ge=1)
    parsed_at: datetime
    parser_version: str
    overall_confidence: float = Field(ge=0, le=1)
    warnings: list[str]


class LeaseContractDocument(DocumentEnvelopeBase):
    doc_type: Literal[DocumentType.LEASE_CONTRACT] = DocumentType.LEASE_CONTRACT
    fields: LeaseContractFields


class SpecialTermsDocument(DocumentEnvelopeBase):
    doc_type: Literal[DocumentType.SPECIAL_TERMS] = DocumentType.SPECIAL_TERMS
    fields: SpecialTermsFields


class DisclosureDocument(DocumentEnvelopeBase):
    doc_type: Literal[DocumentType.DISCLOSURE] = DocumentType.DISCLOSURE
    fields: DisclosureFields


class MutualAidDocument(DocumentEnvelopeBase):
    doc_type: Literal[DocumentType.MUTUAL_AID] = DocumentType.MUTUAL_AID
    fields: MutualAidFields


ContractDocument = (
    LeaseContractDocument | SpecialTermsDocument | DisclosureDocument | MutualAidDocument
)


class OcrPage(BaseModel):
    page: int = Field(ge=1)
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    text: str
    method: ExtractionMethod


class ExtractionResponse(BaseModel):
    mode: ExtractionMode
    source_file: str
    page_count: int
    mask_count: int
    coarse_mask_count: int
    review_required: bool
    ocr_pages: list[OcrPage]
    documents: list[ContractDocument] = Field(default_factory=list)
    missing_doc_types: list[DocumentType] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
