"""PDF text & table extraction with PyMuPDF and OCR fallback for Suits AI."""

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
    """Extract text, tables, and page count from a PDF file.

    Uses PyMuPDF (fitz) for text-layer extraction and ``page.find_tables()``
    for structured table data.  Tables are rendered as Markdown and inserted
    at the correct position in the page text so downstream agents see them in
    reading order.

    If the extracted text contains fewer than 50 words the document is assumed
    to be scanned, and every page is rendered as an image then OCR'd via
    pytesseract (tables cannot be extracted from scanned pages this way).

    Args:
        file_path: Absolute path to the PDF file.

    Returns:
        Tuple of (extracted_text, page_count).

    Raises:
        FileNotFoundError: If *file_path* does not exist.
    """
    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"PDF file not found: {file_path}")

    logger.info(
        f"Parsing PDF: {path.name}",
        extra={"status": "pdf_parse_start"},
    )

    # -- Primary extraction via PyMuPDF text layer + tables -------------------
    text, page_count, table_count = _extract_with_pymupdf(file_path)

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


def _table_to_markdown(table: fitz.table.Table) -> str:
    """Convert a PyMuPDF Table object into a Markdown table string."""
    try:
        rows = table.extract()
    except Exception:
        return ""

    if not rows:
        return ""

    # Clean None / empty cells
    cleaned: list[list[str]] = []
    for row in rows:
        cleaned.append([cell.strip() if cell else "" for cell in row])

    if not cleaned:
        return ""

    col_count = max(len(r) for r in cleaned)

    # Pad rows that are shorter than the widest row
    for row in cleaned:
        while len(row) < col_count:
            row.append("")

    lines: list[str] = []
    # Header row
    lines.append("| " + " | ".join(cleaned[0]) + " |")
    # Separator
    lines.append("| " + " | ".join("---" for _ in range(col_count)) + " |")
    # Data rows
    for row in cleaned[1:]:
        lines.append("| " + " | ".join(row) + " |")

    return "\n".join(lines)


def _extract_with_pymupdf(file_path: str) -> tuple[str, int, int]:
    """Use PyMuPDF to extract text and tables from every page.

    Tables are detected via ``page.find_tables()``, converted to Markdown,
    and appended after the page's plain text so the LLM can interpret them.

    Returns:
        (full_text, page_count, total_tables_found)
    """
    doc = fitz.open(file_path)
    page_count = len(doc)
    pages_text: list[str] = []
    total_tables = 0

    for page_num in range(page_count):
        page = doc[page_num]
        parts: list[str] = []

        # --- Plain text extraction ---
        page_text = page.get_text("text")
        if page_text and page_text.strip():
            parts.append(page_text.strip())

        # --- Table extraction ---
        try:
            tables = page.find_tables()
            if tables and tables.tables:
                for table in tables.tables:
                    md = _table_to_markdown(table)
                    if md:
                        total_tables += 1
                        parts.append(f"\n[Table on page {page_num + 1}]\n{md}\n")
        except Exception as exc:
            logger.debug(
                f"Table extraction failed on page {page_num + 1}: {exc}",
                extra={"status": "table_extract_warn"},
            )

        if parts:
            pages_text.append("\n\n".join(parts))

    doc.close()

    logger.info(
        f"PyMuPDF extracted text from {len(pages_text)}/{page_count} pages, "
        f"{total_tables} table(s) found",
        extra={"status": "pymupdf_done"},
    )
    return "\n\n".join(pages_text), page_count, total_tables


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
