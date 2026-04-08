"""Smart clause chunking for RAG indexing.

Splits clauses into appropriately-sized chunks with sentence-level overlap
for context continuity during retrieval.
"""

from __future__ import annotations

import re

from logging_config import get_logger

logger = get_logger("rag.chunker")


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences using a simple regex heuristic.

    Handles common abbreviations and decimal numbers to avoid false splits.
    """
    # Split on sentence-ending punctuation followed by whitespace and an uppercase letter
    # or end-of-string. This avoids splitting on "e.g." or "Rs. 5000".
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text.strip())
    return [s.strip() for s in parts if s.strip()]


def _word_count(text: str) -> int:
    """Return the number of whitespace-delimited tokens in *text*."""
    return len(text.split())


def chunk_clauses(
    clauses: list[dict],
    max_chunk_size: int = 500,
    overlap_sentences: int = 1,
) -> list[dict]:
    """Convert a list of clause dicts into RAG-ready chunks.

    Parameters
    ----------
    clauses:
        Each dict must have at least ``clause_id`` and ``text``.
        Optional keys: ``title``, ``page_number``.
    max_chunk_size:
        Maximum number of words per chunk.  Clauses exceeding this are
        split on sentence boundaries.
    overlap_sentences:
        Number of trailing sentences from the previous sub-chunk to
        prepend to the next sub-chunk (for context continuity).

    Returns
    -------
    list[dict]
        Each chunk dict contains: ``chunk_id``, ``text``, ``clause_id``,
        ``title``, ``page``.
    """
    chunks: list[dict] = []

    for clause in clauses:
        clause_id = clause.get("clause_id", 0)
        text = clause.get("text", "").strip()
        title = clause.get("title", "")
        page = clause.get("page_number", clause.get("page", 1))

        if not text:
            logger.debug(
                "Skipping empty clause",
                extra={"agent": "chunker", "status": "skip"},
            )
            continue

        # Fast path: clause fits within the size limit
        if _word_count(text) <= max_chunk_size:
            chunks.append(
                {
                    "chunk_id": f"clause_{clause_id}",
                    "text": text,
                    "clause_id": clause_id,
                    "title": title,
                    "page": page,
                }
            )
            continue

        # Slow path: split on sentence boundaries with overlap
        sentences = _split_sentences(text)
        if not sentences:
            # Fallback — treat entire text as one chunk even if oversized
            chunks.append(
                {
                    "chunk_id": f"clause_{clause_id}",
                    "text": text,
                    "clause_id": clause_id,
                    "title": title,
                    "page": page,
                }
            )
            continue

        part_num = 0
        start_idx = 0

        while start_idx < len(sentences):
            # Accumulate sentences until we hit the word budget
            current_sentences: list[str] = []
            current_words = 0

            idx = start_idx
            while idx < len(sentences):
                sentence_words = _word_count(sentences[idx])
                if current_sentences and current_words + sentence_words > max_chunk_size:
                    break
                current_sentences.append(sentences[idx])
                current_words += sentence_words
                idx += 1

            # Guard against a single sentence exceeding max_chunk_size
            if not current_sentences:
                current_sentences.append(sentences[start_idx])
                idx = start_idx + 1

            part_num += 1
            chunk_text = " ".join(current_sentences)
            chunks.append(
                {
                    "chunk_id": f"clause_{clause_id}_part_{part_num}",
                    "text": chunk_text,
                    "clause_id": clause_id,
                    "title": title,
                    "page": page,
                }
            )

            # Advance start, but step back by overlap_sentences for context
            next_start = idx
            if next_start < len(sentences) and overlap_sentences > 0:
                next_start = max(next_start - overlap_sentences, start_idx + 1)
            start_idx = next_start if next_start > start_idx else idx

    logger.info(
        "Chunking complete",
        extra={
            "agent": "chunker",
            "status": "success",
            "clauses_in": len(clauses),
            "chunks_out": len(chunks),
        },
    )
    return chunks
