"""Ingestion pipeline for Suits AI.

Composes PDF parsing, image OCR, and LLM-based clause segmentation
into a single pipeline that converts uploaded documents into structured clauses.
"""

from __future__ import annotations

from pathlib import Path

from config import Settings
from llm_client import LLMClient
from logging_config import get_logger
from models import Clause

from ingestion.clause_segmenter import ClauseSegmenter
from ingestion.image_parser import parse_image
from ingestion.pdf_parser import parse_pdf

logger = get_logger("ingestion.pipeline")

# Content types routed to the image parser
_IMAGE_CONTENT_TYPES = frozenset({
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/tiff",
    "image/bmp",
    "image/webp",
})

# Content types routed to the PDF parser
_PDF_CONTENT_TYPES = frozenset({
    "application/pdf",
})

# Content types for plain text (read directly, no special parser needed)
_TEXT_CONTENT_TYPES = frozenset({
    "text/plain",
    "text/html",
    "text/rtf",
})


class IngestorPipeline:
    """End-to-end document ingestion: parse -> segment -> structured clauses."""

    def __init__(self, llm_client: LLMClient, settings: Settings) -> None:
        self.llm_client = llm_client
        self.settings = settings
        self.clause_segmenter = ClauseSegmenter(
            llm_client=llm_client,
            model_config=settings.agent_models.segmenter,
        )

    async def ingest(
        self,
        document_id: str,
        file_path: str,
        content_type: str,
    ) -> tuple[list[Clause], int]:
        """Run the full ingestion pipeline on an uploaded document.

        Steps:
            1. Select parser based on *content_type* (PDF, image OCR, or text).
            2. Extract raw text from the document.
            3. Segment the raw text into structured clauses via LLM.
            4. Return the list of validated ``Clause`` objects and page count.

        Args:
            document_id: Unique identifier for the document.
            file_path: Path to the uploaded file on disk.
            content_type: MIME type of the uploaded file.

        Returns:
            Tuple of (list of Clause objects, page_count).

        Raises:
            ValueError: If the content type is unsupported or no text is found.
            RuntimeError: If text extraction or segmentation fails.
        """
        logger.info(
            f"Starting ingestion for document {document_id} ({content_type})",
            extra={"status": "ingestion_start"},
        )

        # Step 1 & 2: Extract raw text
        raw_text, page_count = self._extract_text(file_path, content_type)

        if not raw_text:
            logger.warning(
                f"No text extracted from document {document_id}",
                extra={"status": "empty_document"},
            )
            return [], page_count

        logger.info(
            f"Extracted {len(raw_text.split())} words from {page_count} page(s)",
            extra={"status": "extraction_complete"},
        )

        # Step 3: Segment into clauses via LLM
        clause_dicts = await self.clause_segmenter.segment(raw_text)

        # Step 4: Convert raw dicts to validated Clause objects
        clauses = self._build_clauses(clause_dicts)

        logger.info(
            f"Ingestion complete: {len(clauses)} clauses from document {document_id}",
            extra={"status": "ingestion_complete"},
        )
        return clauses, page_count

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _extract_text(self, file_path: str, content_type: str) -> tuple[str, int]:
        """Route to the correct parser based on content type.

        Returns:
            Tuple of (extracted_text, page_count).
        """
        ct = content_type.lower().strip()

        if ct in _PDF_CONTENT_TYPES:
            return parse_pdf(file_path)

        if ct in _IMAGE_CONTENT_TYPES:
            text = parse_image(file_path)
            return text, 1

        if ct in _TEXT_CONTENT_TYPES:
            return self._read_text_file(file_path)

        raise ValueError(
            f"Unsupported content type: {content_type}. "
            f"Supported: PDF ({', '.join(_PDF_CONTENT_TYPES)}), "
            f"image ({', '.join(_IMAGE_CONTENT_TYPES)}), "
            f"text ({', '.join(_TEXT_CONTENT_TYPES)})."
        )

    @staticmethod
    def _read_text_file(file_path: str) -> tuple[str, int]:
        """Read a plain text file directly.

        Estimates page count as roughly 1 page per 3 000 characters.
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Text file not found: {file_path}")

        text = path.read_text(encoding="utf-8", errors="replace")
        # Rough page estimate (one page ~ 3000 chars of legal text)
        page_count = max(1, len(text) // 3000)

        logger.info(
            f"Read text file directly: {len(text)} chars, ~{page_count} page(s)",
            extra={"status": "text_read"},
        )
        return text.strip(), page_count

    @staticmethod
    def _build_clauses(clause_dicts: list[dict]) -> list[Clause]:
        """Convert raw clause dicts from the segmenter into validated Clause objects.

        Malformed entries are logged and skipped rather than failing the pipeline.
        """
        clauses: list[Clause] = []
        for i, item in enumerate(clause_dicts, start=1):
            try:
                clause = Clause(
                    clause_id=item.get("clause_id", i),
                    section_number=item.get("section_number"),
                    title=item.get("title", f"Clause {i}"),
                    text=item.get("text", ""),
                    page_number=item.get("page_number", 1),
                    clause_type_hint=item.get("clause_type_hint"),
                )
                clauses.append(clause)
            except Exception as exc:
                logger.warning(
                    f"Skipping malformed clause at index {i}: {exc}",
                    extra={"status": "clause_parse_error"},
                )
        return clauses
