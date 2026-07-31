import logging
from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.document.pdf_renderer import PdfRenderer
from app.document.preprocessor import preprocess_page
from app.errors import PiiRemainsError
from app.inference.engine import DocumentOcrEngine
from app.inference.result_parser import order_regions
from app.inference.types import TextRegion
from app.masking.coordinate_mapper import MaskRegion, map_match_to_region
from app.masking.detector import PiiDetector
from app.masking.renderer import MaskRenderer
from app.masking.sanitizer import sanitize_text
from app.masking.validator import has_remaining_pii

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProcessingResult:
    output_path: Path
    mask_count: int
    coarse_mask_count: int
    review_required: bool
    sanitized_text: str
    redaction_counts: dict[str, int]
    text_safe_for_analysis: bool


class ContractProcessingPipeline:
    def __init__(self, engine: DocumentOcrEngine, settings: Settings):
        self.engine = engine
        self.renderer = PdfRenderer(settings.OCR_RENDER_DPI, settings.OCR_MAX_PAGES)
        self.mask_renderer = MaskRenderer(settings.OCR_MASK_MARGIN_PX)
        self.detector = PiiDetector()
        self.settings = settings

    def process(self, input_path: Path, work_dir: Path, output_path: Path) -> ProcessingResult:
        rendered_pages = self.renderer.render(input_path, work_dir / "pages")
        pages = [
            preprocess_page(
                page,
                work_dir / "normalized",
                auto_crop=self.settings.OCR_AUTO_CROP,
                crop_threshold=self.settings.OCR_CROP_THRESHOLD,
                crop_padding_px=self.settings.OCR_CROP_PADDING_PX,
                max_long_edge=self.settings.OCR_MAX_IMAGE_LONG_EDGE,
                auto_contrast=self.settings.OCR_AUTO_CONTRAST,
            )
            for page in rendered_pages
        ]
        all_regions: list[MaskRegion] = []
        masked_pages: list[Path] = []
        sanitized_pages: list[str] = []
        redaction_counts: dict[str, int] = {}

        for page in pages:
            # Parsing은 표·문단의 읽기 순서를 보존한 AI 분석 텍스트용이고, Spotting은 실제
            # 픽셀을 가릴 좌표용이다. 하나의 결과를 두 목적으로 재사용하면 표가 많은 PDF에서
            # 분석 텍스트 순서가 쉽게 무너진다.
            parsed = self.engine.parse_page(page.path, page.index)
            semantic_regions = order_regions(parsed.regions)
            spotted = self.engine.spot_page(page.path, page.index)
            spotting_regions = order_regions(spotted.regions)
            page_regions: list[MaskRegion] = []
            for region_index, region in enumerate(spotting_regions):
                previous_text = spotting_regions[region_index - 1].text if region_index > 0 else ""
                matches = self.detector.detect_region(region.text, previous_text)
                for match in matches:
                    page_regions.append(map_match_to_region(region, match))
                if region.label.lower() == "seal":
                    page_regions.append(MaskRegion(page.index, region.bbox, "seal", coarse=True))

            # 레이아웃 Parsing이 빈 결과를 준 경우에만 Spotting 텍스트로 안전하게 폴백한다.
            text_regions = semantic_regions or spotting_regions
            raw_page_text = _join_regions(text_regions)
            sanitized = sanitize_text(raw_page_text, self.detector.detect(raw_page_text))
            for pii_type, count in sanitized.redaction_counts.items():
                redaction_counts[pii_type] = redaction_counts.get(pii_type, 0) + count

            # Parsing의 seal 블록은 Spotting 결과에 label이 보존되지 않을 수 있으므로 추가한다.
            for region in semantic_regions:
                if region.label.lower() == "seal":
                    page_regions.append(MaskRegion(page.index, region.bbox, "seal", coarse=True))

            target = work_dir / f"masked_{page.index + 1:03d}.png"
            self.mask_renderer.render_page(page, page_regions, target)
            masked_pages.append(target)
            all_regions.extend(page_regions)
            sanitized_pages.append(f"[페이지 {page.index + 1}]\n{sanitized.text}")
            logger.info(
                "페이지 OCR 완료 page=%d size=%dx%d parsed_regions=%d spotted_regions=%d "
                "text_chars=%d masks=%d",
                page.index + 1,
                page.width,
                page.height,
                len(semantic_regions),
                len(spotting_regions),
                len(sanitized.text),
                len(page_regions),
            )

        self.mask_renderer.build_flattened_pdf(masked_pages, output_path)

        sanitized_text = "\n\n".join(sanitized_pages).strip()
        text_safe_for_analysis = not self.detector.detect(sanitized_text)
        if not text_safe_for_analysis:
            # 지원하는 개인정보 패턴이 남으면 원문을 Worker 밖으로 내보내지 않는다.
            raise PiiRemainsError()

        # 마스킹된 이미지 자체를 다시 Spotting하여 잔존 개인정보를 확인한다.
        validation_pages = [
            self.engine.spot_page(path, index) for index, path in enumerate(masked_pages)
        ]
        remaining = has_remaining_pii(validation_pages, self.detector)
        coarse_count = sum(region.coarse for region in all_regions)
        return ProcessingResult(
            output_path=output_path,
            mask_count=len(all_regions),
            coarse_mask_count=coarse_count,
            # 글자 단위 좌표가 확정되기 전 coarse 마스킹은 검토 대상으로 둔다.
            review_required=remaining or coarse_count > 0,
            sanitized_text=sanitized_text,
            redaction_counts=redaction_counts,
            text_safe_for_analysis=text_safe_for_analysis,
        )


def _join_regions(regions: list[TextRegion]) -> str:
    """빈 블록을 제외하고 레이아웃 엔진이 정한 읽기 순서로 본문을 만든다."""
    return "\n".join(region.text.strip() for region in regions if region.text.strip()).strip()
