from app.schemas.document import OcrExtractionResponse
from app.services.document_processing.mapper import map_to_risk_engine


def test_mapper_keeps_not_stated_distinct_from_unreadable():
    extraction = OcrExtractionResponse.model_validate(
        {
            "mode": "contract_bundle",
            "source_file": "bundle.pdf",
            "page_count": 2,
            "mask_count": 0,
            "coarse_mask_count": 0,
            "review_required": True,
            "ocr_pages": [],
            "missing_doc_types": ["special_terms", "mutual_aid"],
            "warnings": [],
            "documents": [
                {
                    "doc_type": "lease_contract",
                    "source_file": "bundle.pdf",
                    "page_count": 1,
                    "parsed_at": "2026-07-26T12:00:00+09:00",
                    "parser_version": "1.0.0",
                    "overall_confidence": 0.9,
                    "warnings": [],
                    "fields": {
                        "deposit": {"value": 200000000, "status": "extracted"},
                        "lessor_name": {"value": None, "status": "unreadable"},
                    },
                },
                {
                    "doc_type": "disclosure",
                    "source_file": "bundle.pdf",
                    "page_count": 1,
                    "parsed_at": "2026-07-26T12:00:00+09:00",
                    "parser_version": "1.0.0",
                    "overall_confidence": 0.9,
                    "warnings": [],
                    "fields": {
                        "actual_rights": {
                            "section_status": "not_stated",
                            "prior_deposits_total": {
                                "value": None,
                                "status": "not_stated",
                            },
                            "description": {"value": None, "status": "not_stated"},
                        }
                    },
                },
            ],
        }
    )

    mapped = map_to_risk_engine(extraction)

    assert mapped.contract.deposit == 200000000
    assert mapped.contract.lessor_name is None
    assert mapped.disclosure is not None
    assert mapped.disclosure.prior_deposits_stated is False
    assert "lessor_name" in mapped.unknowns
    assert "actual_rights.prior_deposits_total" in mapped.unknowns
