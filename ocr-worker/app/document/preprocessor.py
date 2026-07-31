import logging
from pathlib import Path

from app.document.page import PageImage

logger = logging.getLogger(__name__)


def preprocess_page(
    page: PageImage,
    output_dir: Path,
    *,
    auto_crop: bool,
    crop_threshold: int,
    crop_padding_px: int,
    max_long_edge: int,
    auto_contrast: bool,
) -> PageImage:
    """PDF와 이미지 입력을 같은 OCR용 RGB 이미지로 정규화한다.

    이후 Spotting 좌표와 픽셀 마스킹은 이 정규화 이미지 하나를 공통으로 사용한다. 따라서
    crop/resize 좌표를 원본으로 역변환할 필요가 없고 PDF와 PNG가 서로 다른 크기 정책을 타지
    않는다. 원본 파일은 수정하지 않는다.
    """
    from PIL import Image, ImageOps

    output_dir.mkdir(parents=True, exist_ok=True)
    with Image.open(page.path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        original_size = image.size

        crop_box = None
        if auto_crop:
            grayscale = ImageOps.grayscale(image)
            # threshold보다 어두운 픽셀을 문서 내용으로 본다. 완전히 빈 페이지는 자르지 않는다.
            content_mask = grayscale.point(lambda value: 255 if value < crop_threshold else 0)
            detected = content_mask.getbbox()
            if detected is not None:
                left, top, right, bottom = detected
                crop_box = (
                    max(0, left - crop_padding_px),
                    max(0, top - crop_padding_px),
                    min(image.width, right + crop_padding_px),
                    min(image.height, bottom + crop_padding_px),
                )
                image = image.crop(crop_box)

        if auto_contrast:
            image = ImageOps.autocontrast(image, cutoff=1)

        resized = False
        if max_long_edge > 0 and max(image.size) > max_long_edge:
            ratio = max_long_edge / max(image.size)
            target = (
                max(1, round(image.width * ratio)),
                max(1, round(image.height * ratio)),
            )
            image = image.resize(target, Image.Resampling.LANCZOS)
            resized = True

        target_path = output_dir / f"page_{page.index + 1:03d}.png"
        image.save(target_path, "PNG")
        normalized = PageImage(page.index, target_path, image.width, image.height)

    logger.info(
        "페이지 정규화 page=%d original=%dx%d crop=%s output=%dx%d resized=%s",
        page.index + 1,
        original_size[0],
        original_size[1],
        crop_box,
        normalized.width,
        normalized.height,
        resized,
    )
    return normalized
