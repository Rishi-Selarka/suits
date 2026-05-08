"""Direct image OCR parser for Suits AI."""

from __future__ import annotations

from pathlib import Path

import pytesseract
from PIL import Image

from logging_config import get_logger

logger = get_logger("ingestion.image_parser")

# Decompression-bomb guard. The 20 MB upload limit caps file bytes, but
# a 20 MB JPEG decodes to a multi-gigabyte raster which then sits in
# memory while pytesseract holds its own working set. Cap at 25 MP so a
# crafted upload can't OOM the worker.
_MAX_IMAGE_PIXELS = 25_000_000
Image.MAX_IMAGE_PIXELS = _MAX_IMAGE_PIXELS


def parse_image(file_path: str) -> str:
    """Extract text from an image file (PNG, JPEG, TIFF, etc.) using OCR.

    Args:
        file_path: Absolute path to the image file.

    Returns:
        Extracted text as a string.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the image exceeds the pixel-count guard.
        RuntimeError: If OCR extraction fails.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Image file not found: {file_path}")

    image = Image.open(file_path)
    pixel_count = image.size[0] * image.size[1]
    if pixel_count > _MAX_IMAGE_PIXELS:
        image.close()
        raise ValueError(
            f"Image too large for OCR: {pixel_count:,} pixels exceeds the "
            f"{_MAX_IMAGE_PIXELS:,}-pixel limit"
        )

    logger.info(
        f"Running OCR on image: {path.name} ({image.size[0]}x{image.size[1]}, {image.mode})",
        extra={"status": "ocr_start"},
    )

    try:
        text = pytesseract.image_to_string(image)
    except Exception as exc:
        logger.error(
            f"OCR extraction failed: {exc}",
            extra={"status": "ocr_error"},
        )
        raise RuntimeError(f"OCR extraction failed for {path.name}: {exc}") from exc

    if not text.strip():
        logger.warning(
            "OCR produced no text from image",
            extra={"status": "empty_extraction"},
        )

    logger.info(
        f"OCR complete: extracted {len(text.split())} words",
        extra={"status": "ocr_complete"},
    )
    return text.strip()
