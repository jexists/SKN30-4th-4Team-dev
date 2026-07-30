from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.document.pdf_renderer import PdfRenderer
from app.document.preprocessor import preprocess_page
from app.inference.engine import DocumentOcrEngine
from app.masking.coordinate_mapper import MaskRegion, map_match_to_region
from app.masking.detector import PiiDetector
from app.masking.renderer import MaskRenderer
from app.masking.sanitizer import sanitize_text
from app.masking.validator import has_remaining_pii


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

    def process(self, input_path: Path, work_dir: Path, output_path: Path) -> ProcessingResult:
        rendered_pages = self.renderer.render(input_path, work_dir / "pages")
        pages = [preprocess_page(page) for page in rendered_pages]
        all_regions: list[MaskRegion] = []
        masked_pages: list[Path] = []
        sanitized_pages: list[str] = []
        redaction_counts: dict[str, int] = {}

        for page in pages:
            spotted = self.engine.spot_page(page.path, page.index)
            page_regions: list[MaskRegion] = []
            sanitized_regions: list[str] = []
            for region_index, region in enumerate(spotted.regions):
                previous_text = (
                    spotted.regions[region_index - 1].text if region_index > 0 else ""
                )
                matches = self.detector.detect_region(region.text, previous_text)
                for match in matches:
                    page_regions.append(map_match_to_region(region, match))
                sanitized = sanitize_text(region.text, matches)
                sanitized_regions.append(sanitized.text)
                for pii_type, count in sanitized.redaction_counts.items():
                    redaction_counts[pii_type] = redaction_counts.get(pii_type, 0) + count
                if region.label.lower() == "seal":
                    page_regions.append(MaskRegion(page.index, region.bbox, "seal", coarse=True))
            target = work_dir / f"masked_{page.index + 1:03d}.png"
            self.mask_renderer.render_page(page, page_regions, target)
            masked_pages.append(target)
            all_regions.extend(page_regions)
            sanitized_pages.append(f"[페이지 {page.index + 1}]\n" + "\n".join(sanitized_regions))

        self.mask_renderer.build_flattened_pdf(masked_pages, output_path)

        sanitized_text = "\n\n".join(sanitized_pages).strip()
        text_safe_for_analysis = not self.detector.detect(sanitized_text)
        if not text_safe_for_analysis:
            # 지원하는 개인정보 패턴이 남으면 원문을 Worker 밖으로 내보내지 않는다.
            raise ValueError("LLM 전달용 텍스트에 개인정보 패턴이 남아 있습니다.")

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
