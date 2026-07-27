from contextlib import nullcontext
from pathlib import Path

from fastapi.testclient import TestClient

from app.extraction.schemas import ExtractionMethod
from app.extraction.types import RecognizedPage
from app.inference.types import ParsedPage, TextRegion
from app.main import app
from app.pipeline.contract_pipeline import ContractProcessingPipeline, ProcessingResult


def _fake_processing_result() -> ProcessingResult:
    return ProcessingResult(
        output_path=Path("masked.pdf"),
        mask_count=1,
        coarse_mask_count=0,
        review_required=False,
        recognized_pages=[
            RecognizedPage(
                parsed=ParsedPage(
                    page_index=0,
                    width=1000,
                    height=1400,
                    regions=[
                        TextRegion(
                            page_index=0,
                            text=(
                                "부동산 임대차계약서\n"
                                "소재지: 서울특별시 강서구\n"
                                "임대인: 김임대\n"
                                "임차인: 박임차\n"
                                "보증금: 200,000,000원"
                            ),
                            bbox=(10, 10, 900, 300),
                            block_order=0,
                        )
                    ],
                ),
                method=ExtractionMethod.TEXT,
            )
        ],
    )


def test_extract_endpoint_accepts_contract_bundle(monkeypatch):
    monkeypatch.setattr(
        ContractProcessingPipeline,
        "process",
        lambda self, input_path, work_dir, output_path: _fake_processing_result(),
    )
    monkeypatch.setattr(
        "app.main.tempfile.TemporaryDirectory",
        lambda **kwargs: nullcontext("virtual-temp"),
    )
    monkeypatch.setattr(Path, "write_bytes", lambda self, content: len(content))

    response = TestClient(app).post(
        "/v1/extract",
        data={"mode": "contract_bundle"},
        files={"file": ("contract.pdf", b"fake-pdf", "application/pdf")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "contract_bundle"
    assert body["documents"][0]["doc_type"] == "lease_contract"
    assert body["documents"][0]["fields"]["deposit"]["value"] == 200_000_000
    assert body["review_required"] is True
