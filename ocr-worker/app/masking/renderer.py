from pathlib import Path

from app.document.page import PageImage
from app.masking.coordinate_mapper import MaskRegion


class MaskRenderer:
    def __init__(self, margin_px: int = 4):
        self.margin_px = margin_px

    def render_page(self, page: PageImage, regions: list[MaskRegion], output_path: Path) -> None:
        from PIL import Image, ImageDraw

        with Image.open(page.path).convert("RGB") as image:
            draw = ImageDraw.Draw(image)
            for region in regions:
                x1, y1, x2, y2 = region.bbox
                box = (
                    max(0, int(x1) - self.margin_px),
                    max(0, int(y1) - self.margin_px),
                    min(image.width, int(x2) + self.margin_px),
                    min(image.height, int(y2) + self.margin_px),
                )
                draw.rectangle(box, fill="black")
            image.save(output_path, "PNG")

    @staticmethod
    def build_flattened_pdf(page_paths: list[Path], output_path: Path) -> None:
        from PIL import Image

        images = [Image.open(path).convert("RGB") for path in page_paths]
        if not images:
            raise ValueError("PDF로 만들 마스킹 페이지가 없습니다.")
        try:
            images[0].save(output_path, "PDF", save_all=True, append_images=images[1:])
        finally:
            for image in images:
                image.close()
