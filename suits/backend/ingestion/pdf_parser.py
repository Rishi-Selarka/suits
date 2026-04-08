"""PDF text extraction with PyMuPDF and OCR fallback for Suits AI."""

from __future__ import annotations

import io
from pathlib import Path

import fitz  # PyMuPDF
import pytesseract
from PIL import Image

from logging_config import get_logger

logger = get_logger("ingestion.pdf_parser")

# Minimum word count threshold -- below this we assume scanned/image PDF
_MIN_WORDS_FOR_TEXT_PDF = 50


def parse_pdf(file_path: str) -> tuple[str, int]:
    """Extract text and page count from a PDF file.

    Uses PyMuPDF (fitz) for text-layer extraction.  If the extracted text
    contains fewer than 50 words the document is assumed to be scanned, and
    every page is rendered to an image then OCR'd via pytesseract.

    Args:
        file_path: Absolute path to the PDF file.

    Returns:
        Tuple of (extracted_text, page_count).

    Raises:
        FileNotFoundError: If *file_path* does not exist.
        RuntimeError: If both text extraction and OCR produce no output.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF file not found: {file_path}")

    logger.info(
        f"Parsing PDF: {path.name}",
        extra={"status": "pdf_parse_start"},
    )

    # -- Primary extraction via PyMuPDF text layer -------------------------
    text, page_count = _extract_with_pymupdf(file_path)

    word_count = len(text.split())
    if word_count < _MIN_WORDS_FOR_TEXT_PDF:
        logger.info(
            f"Low text extraction ({word_count} words) -- attempting OCR fallback",
            extra={"status": "ocr_fallback"},
        )
        ocr_text = _extract_with_ocr(file_path)
        if ocr_text and len(ocr_text.split()) > word_count:
            text = ocr_text

    if not text.strip():
        logger.warning(
            "No text could be extracted from PDF (text-layer and OCR both empty)",
            extra={"status": "empty_extraction"},
        )

    return text.strip(), page_count


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _extract_with_pymupdf(file_path: str) -> tuple[str, int]:
    """Use PyMuPDF (fitz) to extract text from every page."""
    doc = fitz.open(file_path)
    page_count = len(doc)
    pages_text: list[str] = []

    for page_num in range(page_count):
        page = doc[page_num]
        page_text = page.get_text("text")
        if page_text:
            pages_text.append(page_text)

    doc.close()
    logger.info(
        f"PyMuPDF extracted text from {len(pages_text)}/{page_count} pages",
        extra={"status": "pymupdf_done"},
    )
    return "\n\n".join(pages_text), page_count


def _extract_with_ocr(file_path: str) -> str:
    """Render each PDF page as an image and run pytesseract OCR.

    Returns the concatenated OCR text, or an empty string if OCR fails
    on every page.
    """
    doc = fitz.open(file_path)
    total_pages = len(doc)
    pages_text: list[str] = []

    for page_num in range(total_pages):
        page = doc[page_num]
        # Render at 300 DPI for good OCR quality
        mat = fitz.Matrix(300 / 72, 300 / 72)
        pix = page.get_pixmap(matrix=mat)
        img_bytes = pix.tobytes("png")
        image = Image.open(io.BytesIO(img_bytes))

        try:
            page_text = pytesseract.image_to_string(image)
            if page_text:
                pages_text.append(page_text)
        except Exception as exc:
            logger.warning(
                f"OCR failed on page {page_num + 1}: {exc}",
                extra={"status": "ocr_page_error"},
            )

    doc.close()
    logger.info(
        f"OCR extracted text from {len(pages_text)}/{total_pages} pages",
        extra={"status": "ocr_done"},
    )
    return "\n\n".join(pages_text)
