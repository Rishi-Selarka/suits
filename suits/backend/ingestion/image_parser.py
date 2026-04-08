"""Direct image OCR parser for Suits AI."""

from __future__ import annotations

from pathlib import Path

import pytesseract
from PIL import Image

from logging_config import get_logger

logger = get_logger("ingestion.image_parser")


def parse_image(file_path: str) -> str:
    """Extract text from an image file (PNG, JPEG, TIFF, etc.) using OCR.

    Args:
        file_path: Absolute path to the image file.

    Returns:
        Extracted text as a string.

    Raises:
        FileNotFoundError: If the file does not exist.
        RuntimeError: If OCR extraction fails.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Image file not found: {file_path}")

    image = Image.open(file_path)
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
