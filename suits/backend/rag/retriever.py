"""Hybrid retrieval with LLM re-ranking and RAG-based Q&A.

Combines semantic search (ChromaDB) with keyword matching, then uses an
LLM to re-rank candidates before answering user questions grounded in
the retrieved clauses.
"""

from __future__ import annotations

import json
import re

from config import Settings
from llm_client import LLMClient
from logging_config import get_logger
from models import ChatResponse
from rag.embeddings import EmbeddingManager

logger = get_logger("rag.retriever")

# ── Prompts ──────────────────────────────────────────────────────────────────

_RERANK_SYSTEM_PROMPT = (
    "Rank these document excerpts by relevance to the user's question. "
    "Return a JSON array of clause_ids in order of relevance."
)

RAG_CHAT_SYSTEM_PROMPT = (
    "You are a legal document Q&A assistant. Answer the user's question based ONLY "
    "on the provided document clauses.\n\n"
    "Rules:\n"
    '- Always cite which clause(s) your answer comes from: "According to Clause 5 (Termination)..."\n'
    "- If the answer isn't in the document, say \"This document doesn't address that topic.\"\n"
    "- Use simple language, not legalese\n"
    "- If the question is about rights, also mention any relevant obligations\n"
    '- If there\'s ambiguity in the clause, flag it: "This clause is ambiguous and could be interpreted as..."'
)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _keyword_score(text: str, keywords: list[str]) -> int:
    """Count how many *keywords* appear (case-insensitive) in *text*."""
    text_lower = text.lower()
    return sum(1 for kw in keywords if kw in text_lower)


def _extract_clause_id_list(text: str) -> list[int]:
    """Best-effort extraction of a JSON int array from LLM output."""
    # Try direct JSON parse first
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [int(x) for x in parsed]
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Fallback: find first JSON array via regex
    match = re.search(r"\[[\s\S]*?\]", text)
    if match:
        try:
            parsed = json.loads(match.group())
            if isinstance(parsed, list):
                return [int(x) for x in parsed]
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

    return []


# ── Main class ───────────────────────────────────────────────────────────────

class DocumentRetriever:
    """Hybrid retriever: semantic + keyword search, LLM re-ranking, RAG Q&A."""

    def __init__(
        self,
        embedding_manager: EmbeddingManager,
        llm_client: LLMClient,
        settings: Settings,
    ) -> None:
        self._emb = embedding_manager
        self._llm = llm_client
        self._settings = settings

    # ------------------------------------------------------------------
    # Retrieval
    # ------------------------------------------------------------------

    async def retrieve(
        self,
        document_id: str,
        query: str,
        clauses: list[dict],
        top_k: int = 5,
    ) -> list[dict]:
        """Return the *top_k* most relevant clauses for *query*.

        Pipeline:
        1. Semantic search via ChromaDB (top 10)
        2. Keyword search on raw clauses (complement semantic hits)
        3. Deduplicate by clause_id, merge
        4. LLM re-rank the merged candidates
        5. Return top_k
        """
        # Step 1: Semantic search
        semantic_hits = self._emb.query(document_id, query, top_k=10)
        seen_clause_ids: set[int] = set()
        candidates: list[dict] = []

        for hit in semantic_hits:
            cid = int(hit.get("clause_id", 0))
            if cid not in seen_clause_ids:
                seen_clause_ids.add(cid)
                candidates.append(hit)

        # Step 2: Keyword search
        keywords = [w.lower() for w in query.split() if len(w) > 2]
        keyword_scored: list[tuple[int, dict]] = []
        for clause in clauses:
            cid = clause.get("clause_id", 0)
            if cid in seen_clause_ids:
                continue
            text = clause.get("text", "") + " " + clause.get("title", "")
            score = _keyword_score(text, keywords)
            if score > 0:
                keyword_scored.append((score, clause))

        keyword_scored.sort(key=lambda x: x[0], reverse=True)

        for _score, clause in keyword_scored[:5]:
            cid = clause.get("clause_id", 0)
            if cid not in seen_clause_ids:
                seen_clause_ids.add(cid)
                candidates.append(
                    {
                        "chunk_id": f"clause_{cid}",
                        "text": clause.get("text", ""),
                        "clause_id": cid,
                        "title": clause.get("title", ""),
                        "page": clause.get("page_number", clause.get("page", 1)),
                        "distance": None,  # no distance for keyword hits
                    }
                )

        if not candidates:
            logger.warning(
                "No candidates found for query",
                extra={"agent": "retriever", "status": "empty"},
            )
            return []

        # Step 3: already deduplicated above

        # Step 4: LLM re-ranking
        ranked = await self._rerank(query, candidates, top_k)
        return ranked

    # ------------------------------------------------------------------
    # Re-ranking
    # ------------------------------------------------------------------

    async def _rerank(
        self,
        query: str,
        candidates: list[dict],
        top_k: int,
    ) -> list[dict]:
        """Use the LLM to re-rank *candidates* by relevance to *query*."""
        # Build a concise excerpt list for the LLM
        excerpts: list[str] = []
        cid_to_candidate: dict[int, dict] = {}
        for c in candidates:
            cid = int(c.get("clause_id", 0))
            title = c.get("title", "Untitled")
            text = c.get("text", "")
            # Truncate long texts to keep the re-rank prompt manageable
            preview = text[:600] + "..." if len(text) > 600 else text
            excerpts.append(f"clause_id={cid} | {title}: {preview}")
            cid_to_candidate[cid] = c

        user_message = (
            f"User question: {query}\n\n"
            "Document excerpts:\n"
            + "\n---\n".join(excerpts)
            + "\n\nReturn a JSON array of clause_ids ranked by relevance."
        )

        rag_config = self._settings.agent_models.rag_chat
        try:
            response = await self._llm.call_with_retry(
                rag_config, _RERANK_SYSTEM_PROMPT, user_message
            )
            ordered_ids = _extract_clause_id_list(response.text)
        except Exception:
            logger.warning(
                "LLM re-ranking failed — falling back to original order",
                extra={"agent": "retriever", "status": "fallback"},
            )
            ordered_ids = []

        # Build final list respecting LLM ordering, then append any the LLM missed
        result: list[dict] = []
        used: set[int] = set()

        for cid in ordered_ids:
            if cid in cid_to_candidate and cid not in used:
                used.add(cid)
                result.append(cid_to_candidate[cid])

        # Append remaining candidates the LLM may have omitted
        for c in candidates:
            cid = int(c.get("clause_id", 0))
            if cid not in used:
                used.add(cid)
                result.append(c)

        return result[:top_k]

    # ------------------------------------------------------------------
    # RAG Q&A
    # ------------------------------------------------------------------

    async def answer(
        self,
        document_id: str,
        query: str,
        clauses: list[dict],
        conversation_history: list[dict] | None = None,
    ) -> ChatResponse:
        """Answer *query* grounded in the document's clauses via RAG.

        Parameters
        ----------
        document_id:
            The document to search.
        query:
            The user's natural-language question.
        clauses:
            Full list of clause dicts for keyword fallback.
        conversation_history:
            Previous turns (``[{"role": ..., "content": ...}, ...]``).

        Returns
        -------
        ChatResponse
            ``answer`` text and ``source_clauses`` used.
        """
        # Retrieve relevant chunks
        relevant = await self.retrieve(document_id, query, clauses, top_k=5)

        if not relevant:
            return ChatResponse(
                answer="I couldn't find any relevant clauses in this document to answer your question.",
                source_clauses=[],
            )

        # Build context block
        context_parts: list[str] = []
        source_clauses: list[dict] = []
        for chunk in relevant:
            cid = chunk.get("clause_id", 0)
            title = chunk.get("title", "Untitled")
            text = chunk.get("text", "")
            context_parts.append(f"[Clause {cid} — {title}]\n{text}")
            source_clauses.append(
                {
                    "clause_id": cid,
                    "title": title,
                    "page": chunk.get("page", 1),
                }
            )

        context_block = "\n\n---\n\n".join(context_parts)

        # Build user message
        user_parts: list[str] = []

        # Include conversation history for multi-turn context
        if conversation_history:
            history_lines: list[str] = []
            for turn in conversation_history:
                role = turn.get("role", "user").capitalize()
                content = turn.get("content", "")
                history_lines.append(f"{role}: {content}")
            user_parts.append(
                "Previous conversation:\n" + "\n".join(history_lines) + "\n"
            )

        user_parts.append(f"Document clauses:\n{context_block}")
        user_parts.append(f"\nQuestion: {query}")

        user_message = "\n\n".join(user_parts)

        # Call LLM
        rag_config = self._settings.agent_models.rag_chat
        try:
            response = await self._llm.call_with_retry(
                rag_config, RAG_CHAT_SYSTEM_PROMPT, user_message
            )
            answer_text = response.text.strip()
        except Exception as exc:
            logger.error(
                "RAG answer generation failed",
                extra={"agent": "retriever", "status": "failed"},
                exc_info=exc,
            )
            return ChatResponse(
                answer="Sorry, I was unable to generate an answer at this time. Please try again.",
                source_clauses=source_clauses,
            )

        logger.info(
            "RAG answer generated",
            extra={
                "agent": "retriever",
                "status": "success",
                "model": response.model,
                "tokens_in": response.tokens_in,
                "tokens_out": response.tokens_out,
                "latency_ms": response.latency_ms,
                "source_clause_count": len(source_clauses),
            },
        )

        return ChatResponse(answer=answer_text, source_clauses=source_clauses)
