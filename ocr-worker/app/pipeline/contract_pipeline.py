from dataclasses import dataclass
from pathlib import Path

from app.core.config import Settings
from app.document.pdf_renderer import PdfRenderer
from app.document.preprocessor import preprocess_page
from app.inference.engine import DocumentOcrEngine
from app.masking.coordinate_mapper import MaskRegion, map_match_to_region
from app.masking.detector import PiiDetector
from app.masking.renderer import MaskRenderer
from app.masking.validator import has_remaining_pii


@dataclass(frozen=True)
class ProcessingResult:
    output_path: Path
    mask_count: int
    coarse_mask_count: int
    review_required: bool


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

        for page in pages:
            spotted = self.engine.spot_page(page.path, page.index)
            page_regions: list[MaskRegion] = []
            for region in spotted.regions:
                for match in self.detector.detect(region.text):
                    page_regions.append(map_match_to_region(region, match))
                if region.label.lower() == "seal":
                    page_regions.append(MaskRegion(page.index, region.bbox, "seal", coarse=True))
            target = work_dir / f"masked_{page.index + 1:03d}.png"
            self.mask_renderer.render_page(page, page_regions, target)
            masked_pages.append(target)
            all_regions.extend(page_regions)

        self.mask_renderer.build_flattened_pdf(masked_pages, output_path)

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
        )
