"""LLM-based clause segmentation for Suits AI."""

from __future__ import annotations

import json
import re
from typing import Any

from config import ModelConfig
from llm_client import LLMClient
from logging_config import get_logger

logger = get_logger("ingestion.clause_segmenter")

SEGMENTER_PROMPT = """\
You are a legal document clause segmenter. Given the raw text of a legal document, \
identify and extract every distinct clause or section.

For each clause, output a JSON array where each element has:
- "clause_id": Sequential integer starting from 1
- "section_number": The section/clause number as written in the document (e.g., "3.1", "IV", "Schedule A") or null if unnumbered
- "title": The clause title/heading if present, otherwise generate a descriptive title
- "text": The full text of the clause (preserve exact wording)
- "page_number": Approximate page number (based on position in text)
- "clause_type_hint": Your best guess at the clause type (e.g., "termination", "payment", "liability", "definitions", "general")

Rules:
- Treat preamble/recitals as a single clause
- Treat each numbered section/subsection as a separate clause
- Definitions sections should be kept as ONE clause (don't split each definition)
- Schedules/annexures are separate clauses
- Signature blocks are NOT clauses — exclude them
- If a clause has sub-clauses (a, b, c), keep them together as one clause

Respond with ONLY a JSON array. No explanation."""

# Chunking thresholds
_CHUNK_TRIGGER_WORDS = 15000
_CHUNK_TARGET_WORDS = 10000


class ClauseSegmenter:
    """Segment raw document text into structured clauses using an LLM."""

    def __init__(self, llm_client: LLMClient, model_config: ModelConfig) -> None:
        self.llm_client = llm_client
        self.model_config = model_config

    async def segment(self, raw_text: str) -> list[dict[str, Any]]:
        """Segment document text into a list of clause dicts.

        Each dict contains fields matching the ``Clause`` model:
        clause_id, section_number, title, text, page_number, clause_type_hint.

        For large documents (>15 000 words) the text is split into ~10 000-word
        chunks at paragraph boundaries, each chunk is segmented independently,
        and the results are merged with clause_ids renumbered sequentially.

        Args:
            raw_text: Full extracted text of the legal document.

        Returns:
            List of clause dicts with sequential clause_ids.

        Raises:
            RuntimeError: If the LLM call fails after retries.
            ValueError: If the LLM response cannot be parsed as JSON.
        """
        words = raw_text.split()
        word_count = len(words)

        logger.info(
            f"Segmenting document ({word_count} words)",
            extra={"status": "segmenting"},
        )

        if word_count > _CHUNK_TRIGGER_WORDS:
            chunks = self._split_into_chunks(raw_text)
            logger.info(
                f"Document split into {len(chunks)} chunks for segmentation",
                extra={"status": "chunked"},
            )
            all_clauses: list[dict[str, Any]] = []
            for i, chunk in enumerate(chunks):
                chunk_word_count = len(chunk.split())
                logger.info(
                    f"Segmenting chunk {i + 1}/{len(chunks)} ({chunk_word_count} words)",
                    extra={"status": "chunk_processing"},
                )
                chunk_clauses = await self._segment_chunk(chunk)
                all_clauses.extend(chunk_clauses)

            # Re-number clause_ids sequentially after merging
            for idx, clause in enumerate(all_clauses, start=1):
                clause["clause_id"] = idx

            logger.info(
                f"Segmentation complete: {len(all_clauses)} clauses from {len(chunks)} chunks",
                extra={"status": "segmentation_complete"},
            )
            return all_clauses
        else:
            clauses = await self._segment_chunk(raw_text)
            logger.info(
                f"Segmentation complete: {len(clauses)} clauses",
                extra={"status": "segmentation_complete"},
            )
            return clauses

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _segment_chunk(self, text: str) -> list[dict[str, Any]]:
        """Send a single chunk to the LLM and parse the response."""
        user_message = (
            f"Segment the following legal document into clauses:\n\n{text}"
        )

        response = await self.llm_client.call_with_retry(
            config=self.model_config,
            system_prompt=SEGMENTER_PROMPT,
            user_message=user_message,
        )

        logger.info(
            f"Segmenter LLM response received ({response.tokens_out} tokens)",
            extra={
                "model": response.model,
                "tokens_in": response.tokens_in,
                "tokens_out": response.tokens_out,
                "latency_ms": response.latency_ms,
                "status": "llm_complete",
            },
        )

        return self._extract_json(response.text)

    def _extract_json(self, text: str) -> list[dict[str, Any]]:
        """Extract a JSON array from LLM response text.

        Handles markdown code fences and falls back to regex extraction.
        """
        cleaned = text.strip()

        # Strip markdown code fences if present
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*\n?", "", cleaned)
            cleaned = re.sub(r"\n?```\s*$", "", cleaned)
            cleaned = cleaned.strip()

        # Attempt direct JSON parse
        try:
            result = json.loads(cleaned)
            if isinstance(result, list):
                return result
        except json.JSONDecodeError:
            pass

        # Fallback: find the first JSON array in the text via regex
        match = re.search(r"\[.*\]", cleaned, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group())
                if isinstance(result, list):
                    return result
            except json.JSONDecodeError:
                pass

        logger.error(
            "Failed to parse JSON from segmenter response",
            extra={"status": "parse_error"},
        )
        raise ValueError(
            "Could not extract valid JSON array from segmenter response"
        )

    def _split_into_chunks(self, text: str) -> list[str]:
        """Split text into ~10 000-word chunks at paragraph boundaries.

        Splits on double-newlines (paragraph breaks) to avoid cutting
        mid-sentence or mid-clause.
        """
        paragraphs = re.split(r"\n\s*\n", text)
        chunks: list[str] = []
        current_chunk: list[str] = []
        current_word_count = 0

        for para in paragraphs:
            para_words = len(para.split())
            if current_word_count + para_words > _CHUNK_TARGET_WORDS and current_chunk:
                chunks.append("\n\n".join(current_chunk))
                current_chunk = []
                current_word_count = 0

            current_chunk.append(para)
            current_word_count += para_words

        # Don't forget the last chunk
        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return chunks
