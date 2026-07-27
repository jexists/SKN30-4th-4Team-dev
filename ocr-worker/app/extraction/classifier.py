import re

from app.extraction.schemas import DocumentType
from app.extraction.types import RecognizedPage


def page_text(page: RecognizedPage) -> str:
    ordered = sorted(
        page.parsed.regions,
        key=lambda region: (
            region.block_order if region.block_order is not None else 10_000,
            region.bbox[1],
            region.bbox[0],
        ),
    )
    return "\n".join(region.text.strip() for region in ordered if region.text.strip())


def classify_text(text: str) -> set[DocumentType]:
    compact = re.sub(r"\s+", "", text)
    result: set[DocumentType] = set()

    if (
        "임대차계약서" in compact
        or "부동산임대차계약" in compact
        or all(keyword in compact for keyword in ("임대인", "임차인", "보증금"))
    ):
        result.add(DocumentType.LEASE_CONTRACT)

    if "특약사항" in compact or "특약조건" in compact:
        result.add(DocumentType.SPECIAL_TERMS)

    if "중개대상물확인" in compact and "설명" in compact:
        result.add(DocumentType.DISCLOSURE)

    if (
        "공제증서" in compact
        or "공제가입증명" in compact
        or ("한국공인중개사협회" in compact and "공제" in compact)
    ):
        result.add(DocumentType.MUTUAL_AID)

    return result


def classify_pages(
    pages: list[RecognizedPage],
) -> dict[DocumentType, list[RecognizedPage]]:
    grouped = {doc_type: [] for doc_type in DocumentType}
    previous: set[DocumentType] = set()

    for page in pages:
        detected = classify_text(page_text(page))
        if not detected and previous:
            detected = previous
        if detected:
            previous = detected
        for doc_type in detected:
            grouped[doc_type].append(page)

    return grouped
