from pathlib import Path

import fitz
import pytest
from PIL import Image, ImageDraw

from app.document.page import PageImage
from app.document.pdf_renderer import PdfRenderer
from app.document.preprocessor import preprocess_page


def test_pdf_renderer_rasterizes_every_page(tmp_path: Path):
    source = tmp_path / "contract.pdf"
    document = fitz.open()
    for text in ("page one", "page two"):
        page = document.new_page(width=595, height=842)
        page.insert_text((72, 72), text)
    document.save(source)
    document.close()

    pages = PdfRenderer(dpi=72, max_pages=2).render(source, tmp_path / "rendered")

    assert len(pages) == 2
    assert pages[0].width == 595
    assert pages[0].height == 842
    assert all(page.path.exists() for page in pages)


def test_pdf_renderer_rejects_too_many_pages(tmp_path: Path):
    source = tmp_path / "long.pdf"
    document = fitz.open()
    document.new_page()
    document.new_page()
    document.save(source)
    document.close()

    with pytest.raises(ValueError, match="최대 1페이지"):
        PdfRenderer(dpi=72, max_pages=1).render(source, tmp_path / "rendered")


def test_preprocessor_crops_whitespace_and_caps_long_edge(tmp_path: Path):
    source = tmp_path / "page.png"
    image = Image.new("RGB", (400, 300), "white")
    ImageDraw.Draw(image).rectangle((100, 80, 300, 220), fill="black")
    image.save(source)

    page = preprocess_page(
        PageImage(0, source, 400, 300),
        tmp_path / "normalized",
        auto_crop=True,
        crop_threshold=245,
        crop_padding_px=10,
        max_long_edge=110,
        auto_contrast=True,
    )

    assert max(page.width, page.height) == 110
    assert page.width < 400
    assert page.height < 300
    assert page.path.exists()


def test_preprocessor_keeps_blank_page(tmp_path: Path):
    source = tmp_path / "blank.png"
    Image.new("RGB", (120, 80), "white").save(source)

    page = preprocess_page(
        PageImage(0, source, 120, 80),
        tmp_path / "normalized",
        auto_crop=True,
        crop_threshold=245,
        crop_padding_px=10,
        max_long_edge=1000,
        auto_contrast=False,
    )

    assert (page.width, page.height) == (120, 80)
