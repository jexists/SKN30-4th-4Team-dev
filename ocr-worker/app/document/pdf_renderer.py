from pathlib import Path

from app.document.page import PageImage


class PdfRenderer:
    def __init__(self, dpi: int = 250, max_pages: int = 20):
        self.dpi = dpi
        self.max_pages = max_pages

    def render(self, input_path: Path, output_dir: Path) -> list[PageImage]:
        output_dir.mkdir(parents=True, exist_ok=True)
        if input_path.suffix.lower() == ".pdf":
            return self._render_pdf(input_path, output_dir)
        return [self._copy_image(input_path, output_dir)]

    def _render_pdf(self, input_path: Path, output_dir: Path) -> list[PageImage]:
        import fitz

        document = fitz.open(input_path)
        if document.page_count > self.max_pages:
            document.close()
            raise ValueError(f"PDF는 최대 {self.max_pages}페이지까지 처리할 수 있습니다.")
        scale = self.dpi / 72
        pages: list[PageImage] = []
        try:
            for index, page in enumerate(document):
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                target = output_dir / f"page_{index + 1:03d}.png"
                pixmap.save(target)
                pages.append(PageImage(index, target, pixmap.width, pixmap.height))
        finally:
            document.close()
        return pages

    @staticmethod
    def _copy_image(input_path: Path, output_dir: Path) -> PageImage:
        from PIL import Image

        with Image.open(input_path) as image:
            normalized = image.convert("RGB")
            target = output_dir / "page_001.png"
            normalized.save(target, "PNG")
            return PageImage(0, target, normalized.width, normalized.height)
