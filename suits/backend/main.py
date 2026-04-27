"""Suits AI — FastAPI application."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sse_starlette.sse import EventSourceResponse

from auth import get_current_user_id
from config import get_settings
from database import Database
from logging_config import get_logger, setup_logging
from llm_client import LLMClient
from models import (
    AnalysisResult,
    ChatRequest,
    ChatResponse,
    CompareRequest,
    DocumentMetadata,
    NegotiateRequest,
    OnboardingRequest,
    PaymentCreateRequest,
    PaymentVerifyRequest,
    QuotaResponse,
    SSEEvent,
    UploadResponse,
    UserResponse,
    UserUpdateRequest,
)
from reports.negotiation_brief import NegotiationBriefGenerator
from storage import Storage

logger = get_logger("main")

# ── Allowed upload content types ─────────────────────────────────────────────

_ALLOWED_CONTENT_TYPES: dict[str, str] = {
    "application/pdf": "application/pdf",
    "image/png": "image/png",
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "text/plain": "text/plain",
}

_EXTENSION_TO_CT: dict[str, str] = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".txt": "text/plain",
}


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Initialise shared resources on startup, clean up on shutdown."""
    settings = get_settings()
    setup_logging(settings.log_level)
    logger.info("Starting Suits AI", extra={"status": "startup"})

    # Fail closed if Supabase looks production-configured but the JWT secret
    # is missing. Without this, the app would boot with auth.py decaying to
    # the shared dev user id and every request mapping to one identity.
    if settings.supabase_configured and not settings.auth_enabled:
        raise RuntimeError(
            "SUPABASE_URL is set but SUPABASE_JWT_SECRET is missing. "
            "Set the JWT secret (Dashboard → Settings → API → JWT Settings) "
            "or unset SUPABASE_URL to run in unauthenticated dev mode."
        )

    # Shared state
    app.state.settings = settings
    app.state.storage = Storage(
        upload_dir=settings.upload_dir,
        results_dir=settings.results_dir,
        metadata_dir=settings.metadata_dir,
    )
    app.state.llm_client = LLMClient(settings)
    app.state.report_generator = NegotiationBriefGenerator()

    # Database
    app.state.db = Database()
    await app.state.db.connect()

    # RAG components — load embedding model in background so server starts fast
    app.state.embedding_manager = None
    app.state.conversation_memory = None

    async def _load_rag() -> None:
        try:
            from rag.embeddings import EmbeddingManager  # type: ignore[import-untyped]
            from rag.conversation import ConversationMemory  # type: ignore[import-untyped]

            # Run heavy model loading in a thread so it doesn't block the event loop
            emb = await asyncio.to_thread(EmbeddingManager)
            app.state.embedding_manager = emb
            app.state.conversation_memory = ConversationMemory()
            logger.info("EmbeddingManager initialised", extra={"status": "rag_ready"})
        except Exception:
            logger.warning("EmbeddingManager not available — RAG chat disabled", extra={"status": "rag_skip"})

    _rag_task = asyncio.create_task(_load_rag())

    def _on_rag_done(t: asyncio.Task[None]) -> None:
        if t.cancelled():
            return
        exc = t.exception()
        if exc is not None:
            logger.error(f"RAG background task failed: {exc}", extra={"status": "error"})

    _rag_task.add_done_callback(_on_rag_done)

    yield

    # Shutdown
    await app.state.db.close()
    await app.state.llm_client.close()
    logger.info("Suits AI shut down", extra={"status": "shutdown"})


# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Suits AI",
    description="Multi-agent legal document analysis platform",
    version="1.0.0",
    lifespan=lifespan,
)


def _add_cors(application: FastAPI) -> None:
    settings = get_settings()
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


_add_cors(app)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _storage(request: Request) -> Storage:
    return request.app.state.storage  # type: ignore[no-any-return]


def _llm(request: Request) -> LLMClient:
    return request.app.state.llm_client  # type: ignore[no-any-return]


def _settings(request: Request):  # noqa: ANN202
    return request.app.state.settings


def _db(request: Request) -> Database:
    return request.app.state.db  # type: ignore[no-any-return]


def _resolve_content_type(upload: UploadFile) -> str:
    """Determine a reliable content type from the upload."""
    ct = (upload.content_type or "").lower().strip()
    if ct in _ALLOWED_CONTENT_TYPES:
        return _ALLOWED_CONTENT_TYPES[ct]
    # Fallback: infer from extension
    filename = upload.filename or ""
    for ext, mapped_ct in _EXTENSION_TO_CT.items():
        if filename.lower().endswith(ext):
            return mapped_ct
    return ct


# ── POST /api/upload ─────────────────────────────────────────────────────────

@app.post("/api/upload", response_model=UploadResponse)
async def upload_document(
    request: Request,
    file: UploadFile = File(...),
    user_id: str = Depends(get_current_user_id),
) -> UploadResponse:
    """Accept a document upload, deduplicate by SHA-256, and store."""
    storage = _storage(request)
    settings = _settings(request)
    db = _db(request)

    # Make sure the profile row exists (Supabase trigger usually handles this,
    # but the dev backend won't have anything until first touch).
    await db.get_or_create_profile(user_id)

    # Validate content type
    content_type = _resolve_content_type(file)
    if content_type not in _ALLOWED_CONTENT_TYPES.values():
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Allowed: PDF, PNG, JPG, JPEG, TXT.",
        )

    # Read file bytes in chunks with streaming size enforcement
    max_bytes = settings.max_file_size_mb * 1024 * 1024
    chunks: list[bytes] = []
    total_size = 0
    while True:
        chunk = await file.read(1024 * 256)  # 256 KB chunks
        if not chunk:
            break
        total_size += len(chunk)
        if total_size > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"File too large (>{settings.max_file_size_mb} MB). Maximum: {settings.max_file_size_mb} MB.",
            )
        chunks.append(chunk)
    data = b"".join(chunks)

    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # SHA-256 dedup (per-user)
    file_hash = hashlib.sha256(data).hexdigest()
    existing = await storage.find_by_hash(user_id, file_hash)
    if existing:
        logger.info(
            f"Duplicate upload detected: {existing.document_id}",
            extra={"status": "cached", "user_id": user_id},
        )
        return UploadResponse(
            document_id=existing.document_id,
            filename=existing.filename,
            page_count=existing.page_count,
            status="cached",
        )

    # New document
    document_id = uuid.uuid4().hex
    import re as _re
    safe_filename = _re.sub(r'[^a-zA-Z0-9._-]', '_', file.filename or "document")[:255]

    storage_path = await storage.save_upload(user_id, document_id, safe_filename, data)

    meta = DocumentMetadata(
        document_id=document_id,
        filename=safe_filename,
        sha256=file_hash,
        file_size_bytes=len(data),
        content_type=content_type,
        status="uploaded",
        storage_path=storage_path,
    )
    await storage.save_metadata(user_id, meta)

    logger.info(
        f"Document uploaded: {document_id}",
        extra={"status": "uploaded", "user_id": user_id},
    )

    return UploadResponse(
        document_id=document_id,
        filename=safe_filename,
        page_count=0,
        status="processing",
    )


# ── POST /api/analyze/{document_id} (SSE) ───────────────────────────────────

@app.post("/api/analyze/{document_id}")
async def analyze_document(
    document_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> EventSourceResponse:
    """Run the full analysis pipeline and stream progress via SSE."""
    storage = _storage(request)
    llm_client = _llm(request)
    settings = _settings(request)
    db = _db(request)

    meta = await storage.get_metadata(user_id, document_id)
    if not meta:
        # Either the document doesn't exist or it belongs to another user.
        # Return 404 in both cases — leak nothing about cross-user state.
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")

    # Quota check (always — caller is authenticated)
    quota = await db.check_quota(user_id)
    if not quota.get("allowed", True):
        raise HTTPException(
            status_code=403,
            detail=f"Quota exceeded. Plan: {quota.get('plan', 'free')}, "
                   f"used: {quota.get('used', 0)}/{quota.get('limit', 0)}. "
                   "Upgrade your plan to continue.",
        )

    # If already analysed, return cached result
    existing_result = await storage.get_result(user_id, document_id)
    if existing_result:
        async def _cached_stream() -> AsyncGenerator[str, None]:
            event = SSEEvent(agent="pipeline", status="cached", data={"document_id": document_id})
            yield json.dumps(event.model_dump(), default=str)

        return EventSourceResponse(_cached_stream())

    async def _event_stream() -> AsyncGenerator[str, None]:
        try:
            # ── Stage 1: Ingestion ───────────────────────────────────────
            yield json.dumps(
                SSEEvent(agent="ingestor", status="running").model_dump(), default=str
            )

            from ingestion import IngestorPipeline

            ingestor = IngestorPipeline(llm_client=llm_client, settings=settings)
            upload_path = await storage.get_upload_path(user_id, document_id)
            if not upload_path:
                yield json.dumps(
                    SSEEvent(agent="ingestor", status="error", error="Upload file not found").model_dump(),
                    default=str,
                )
                return

            ingest_start = time.perf_counter()
            try:
                clauses, page_count = await ingestor.ingest(
                    document_id=document_id,
                    file_path=str(upload_path),
                    content_type=meta.content_type,
                )
            finally:
                # Supabase backend hands us a tempfile copy; clean it up so
                # the OS temp dir doesn't fill up over time. For LocalStorage
                # this is a no-op because the path lives under data/uploads/.
                _cleanup_tempfile(upload_path)
            ingest_ms = int((time.perf_counter() - ingest_start) * 1000)

            # Update metadata (page_count + clause_count + status)
            await storage.update_status(
                user_id, document_id, "processing", clause_count=len(clauses)
            )
            meta_updated = await storage.get_metadata(user_id, document_id)
            if meta_updated:
                meta_updated.page_count = page_count
                await storage.save_metadata(user_id, meta_updated)

            # Save clauses for RAG
            await storage.save_clauses(
                user_id, document_id, [c.model_dump() for c in clauses]
            )

            yield json.dumps(
                SSEEvent(
                    agent="ingestor",
                    status="complete",
                    timing_ms=ingest_ms,
                    data={"clause_count": len(clauses), "page_count": page_count},
                ).model_dump(),
                default=str,
            )

            if not clauses:
                yield json.dumps(
                    SSEEvent(
                        agent="pipeline",
                        status="error",
                        error="No clauses extracted from document.",
                    ).model_dump(),
                    default=str,
                )
                await storage.update_status(user_id, document_id, "error")
                return

            # ── Stage 2: Agent orchestration ─────────────────────────────
            from agents.orchestrator import AgentOrchestrator

            orchestrator = AgentOrchestrator(
                llm_client=llm_client, settings=settings, storage=storage
            )

            async for event in orchestrator.run(
                document_id=document_id, clauses=clauses, user_id=user_id
            ):
                yield json.dumps(event, default=str)

            # Record usage for quota tracking
            try:
                await db.record_usage(user_id, document_id, action="analyze")
            except Exception as usage_exc:
                logger.warning(
                    f"Usage recording failed: {usage_exc}",
                    extra={"status": "usage_error"},
                )

            # Index clauses for RAG chat if embedding manager is available
            if request.app.state.embedding_manager:
                try:
                    from rag.chunker import chunk_clauses
                    chunks = chunk_clauses([c.model_dump() for c in clauses])
                    request.app.state.embedding_manager.index_chunks(document_id, chunks)
                except Exception as rag_exc:
                    logger.warning(
                        f"RAG indexing failed: {rag_exc}",
                        extra={"status": "rag_index_error"},
                    )

        except Exception as exc:
            logger.error(
                f"Pipeline error: {exc}",
                extra={"status": "pipeline_error"},
                exc_info=True,
            )
            try:
                await storage.update_status(user_id, document_id, "error")
            except Exception:
                pass
            yield json.dumps(
                SSEEvent(
                    agent="pipeline",
                    status="error",
                    error=str(exc),
                ).model_dump(),
                default=str,
            )

    return EventSourceResponse(_event_stream())


def _cleanup_tempfile(path) -> None:  # noqa: ANN001
    """Delete `path` if it lives under the OS temp dir. No-op otherwise."""
    import tempfile as _tf
    from pathlib import Path as _P

    try:
        p = _P(path) if not isinstance(path, _P) else path
        tmp_root = _P(_tf.gettempdir()).resolve()
        if tmp_root in p.resolve().parents:
            p.unlink(missing_ok=True)
    except Exception:
        pass


# ── GET /api/results/{document_id} ──────────────────────────────────────────

@app.get("/api/results/{document_id}", response_model=AnalysisResult)
async def get_results(
    document_id: str,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> AnalysisResult:
    """Return the complete analysis result for a document."""
    storage = _storage(request)
    result = await storage.get_result(user_id, document_id)
    if not result:
        meta = await storage.get_metadata(user_id, document_id)
        if meta:
            raise HTTPException(
                status_code=404,
                detail=f"Analysis not yet available for document {document_id} (status: {meta.status}).",
            )
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")
    return result


# ── POST /api/negotiate/stream (AI vs AI negotiation) ──────────────────────

@app.post("/api/negotiate/stream")
async def negotiate_stream(
    body: NegotiateRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> EventSourceResponse:
    """Run an AI vs AI negotiation debate and stream results via SSE."""
    llm_client = _llm(request)
    settings = _settings(request)
    storage = _storage(request)

    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    from prompts.templates import (
        NEGOTIATOR_ADVOCATE_PROMPT,
        NEGOTIATOR_CHALLENGER_PROMPT,
        NEGOTIATOR_CONCLUSION_PROMPT,
    )

    agent1_config = settings.agent_models.negotiator_agent1
    agent2_config = settings.agent_models.negotiator_agent2

    # Build document context if provided. Ownership-scoped: a document_id from
    # another user's namespace returns None and is treated as "no context".
    doc_context = ""
    if body.document_id:
        result = await storage.get_result(user_id, body.document_id)
        if result:
            clauses_raw = await storage.get_clauses(user_id, body.document_id)
            if not clauses_raw:
                clauses_raw = [c.model_dump() for c in result.clauses]
            clause_texts = [
                f"[Clause {c.get('clause_id', '?')}: {c.get('title', '')}] {c.get('text', '')[:400]}"
                for c in clauses_raw[:20]
            ]
            doc_context = "\n\nDocument clauses for reference:\n" + "\n\n".join(clause_texts)

    user_topic = body.message + doc_context

    async def event_generator() -> AsyncGenerator[str, None]:
        try:
            # Conversation histories for each agent
            agent1_messages: list[dict[str, str]] = [
                {"role": "system", "content": NEGOTIATOR_ADVOCATE_PROMPT},
            ]
            agent2_messages: list[dict[str, str]] = [
                {"role": "system", "content": NEGOTIATOR_CHALLENGER_PROMPT},
            ]

            # Signal negotiation start
            yield json.dumps({
                "type": "negotiate_start",
                "rounds": body.rounds,
                "topic": body.message,
            })

            last_response = ""

            for round_num in range(1, body.rounds + 1):
                # ── Agent 1 (Advocate) turn ──
                if round_num == 1:
                    agent1_messages.append({
                        "role": "user",
                        "content": f"The user wants to discuss/negotiate: {user_topic}\n\nMake your opening argument.",
                    })
                else:
                    agent1_messages.append({
                        "role": "user",
                        "content": f"The Challenger responded:\n\n{last_response}\n\nRespond to their points.",
                    })

                yield json.dumps({
                    "type": "agent_start",
                    "agent": "advocate",
                    "round": round_num,
                })

                agent1_response = ""
                async for token in llm_client.call_stream_messages(
                    config=agent1_config,
                    messages=agent1_messages,
                ):
                    agent1_response += token
                    yield json.dumps({
                        "type": "token",
                        "agent": "advocate",
                        "content": token,
                    })

                agent1_messages.append({"role": "assistant", "content": agent1_response})

                yield json.dumps({
                    "type": "agent_end",
                    "agent": "advocate",
                    "round": round_num,
                })

                # ── Agent 2 (Challenger) turn ──
                if round_num == 1:
                    agent2_messages.append({
                        "role": "user",
                        "content": (
                            f"The user wants to discuss/negotiate: {user_topic}\n\n"
                            f"The Advocate opened with:\n\n{agent1_response}\n\nRespond to their arguments."
                        ),
                    })
                else:
                    agent2_messages.append({
                        "role": "user",
                        "content": f"The Advocate responded:\n\n{agent1_response}\n\nRespond to their points.",
                    })

                yield json.dumps({
                    "type": "agent_start",
                    "agent": "challenger",
                    "round": round_num,
                })

                agent2_response = ""
                async for token in llm_client.call_stream_messages(
                    config=agent2_config,
                    messages=agent2_messages,
                ):
                    agent2_response += token
                    yield json.dumps({
                        "type": "token",
                        "agent": "challenger",
                        "content": token,
                    })

                agent2_messages.append({"role": "assistant", "content": agent2_response})
                last_response = agent2_response

                yield json.dumps({
                    "type": "agent_end",
                    "agent": "challenger",
                    "round": round_num,
                })

            # ── Conclusion ──
            yield json.dumps({"type": "conclusion_start"})

            # Build a summary of the full debate for the conclusion agent
            debate_transcript = []
            for round_num in range(1, body.rounds + 1):
                # agent1_messages: system, then pairs of (user, assistant)
                adv_idx = round_num * 2 - 1  # user msg index
                adv_resp = agent1_messages[adv_idx + 1]["content"] if (adv_idx + 1) < len(agent1_messages) else ""
                chl_idx = round_num * 2 - 1  # user msg index for agent2
                chl_resp = agent2_messages[chl_idx + 1]["content"] if (chl_idx + 1) < len(agent2_messages) else ""
                debate_transcript.append(f"Round {round_num} — Advocate: {adv_resp}")
                debate_transcript.append(f"Round {round_num} — Challenger: {chl_resp}")

            conclusion_messages: list[dict[str, str]] = [
                {"role": "system", "content": NEGOTIATOR_CONCLUSION_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Topic: {body.message}\n\n"
                        f"Debate transcript:\n\n" + "\n\n".join(debate_transcript) +
                        "\n\nProvide your conclusion and recommendations."
                    ),
                },
            ]

            # Use agent1's config for the conclusion (any fast model works)
            async for token in llm_client.call_stream_messages(
                config=agent1_config,
                messages=conclusion_messages,
            ):
                yield json.dumps({
                    "type": "token",
                    "agent": "conclusion",
                    "content": token,
                })

            yield json.dumps({
                "type": "done",
                "total_rounds": body.rounds,
            })

        except Exception as exc:
            logger.error(f"Negotiation stream failed: {exc}", extra={"status": "negotiate_error"}, exc_info=True)
            yield json.dumps({"type": "error", "content": f"Negotiation failed: {str(exc)}"})

    return EventSourceResponse(event_generator())


# ── POST /api/chat/stream (streaming general chat) ─────────────────────────
# NOTE: Static routes MUST be defined before parameterized /api/chat/{document_id}

@app.post("/api/chat/stream")
async def general_chat_stream(
    body: ChatRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),  # noqa: ARG001
) -> EventSourceResponse:
    """Streaming general legal advisor chat via SSE."""
    llm_client = _llm(request)
    settings = _settings(request)

    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    from prompts.templates import GENERAL_LEGAL_ADVISOR_PROMPT

    chat_config = settings.agent_models.general_chat

    # Conversation memory for multi-turn context
    memory = getattr(request.app.state, "conversation_memory", None)
    memory_key = body.conversation_id or "general"
    conversation_history: list[dict] = []
    if memory is not None:
        conversation_history = memory.get_history(memory_key)

    # Build full message list with history
    messages: list[dict[str, str]] = [{"role": "system", "content": GENERAL_LEGAL_ADVISOR_PROMPT}]
    for turn in conversation_history:
        messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({"role": "user", "content": body.message})

    async def event_generator() -> AsyncGenerator[str, None]:
        collected = ""
        try:
            async for token in llm_client.call_stream_messages(
                config=chat_config,
                messages=messages,
            ):
                collected += token
                yield json.dumps({"type": "token", "content": token})

            # Persist to memory after successful response
            if memory is not None:
                memory.add_message(memory_key, "user", body.message)
                memory.add_message(memory_key, "assistant", collected)

            yield json.dumps({"type": "done", "source_clauses": []})
        except Exception as exc:
            logger.error(f"Stream chat failed: {exc}", extra={"status": "chat_error"})
            yield json.dumps({"type": "error", "content": "Failed to generate response."})

    return EventSourceResponse(event_generator())


# ── POST /api/chat (general legal advisor — no document needed) ────────────

@app.post("/api/chat", response_model=ChatResponse)
async def general_chat(
    body: ChatRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),  # noqa: ARG001
) -> ChatResponse:
    """General legal advisor chat — no document upload required."""
    llm_client = _llm(request)
    settings = _settings(request)

    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    from prompts.templates import GENERAL_LEGAL_ADVISOR_PROMPT

    chat_config = settings.agent_models.general_chat

    try:
        llm_response = await llm_client.call_with_retry(
            config=chat_config,
            system_prompt=GENERAL_LEGAL_ADVISOR_PROMPT,
            user_message=body.message,
        )
        return ChatResponse(answer=llm_response.text, source_clauses=[])
    except Exception as exc:
        logger.error(f"General chat failed: {exc}", extra={"status": "chat_error"})
        raise HTTPException(status_code=500, detail="Failed to generate response. Please try again.") from exc


# ── POST /api/chat/{document_id} ────────────────────────────────────────────

@app.post("/api/chat/{document_id}", response_model=ChatResponse)
async def chat_with_document(
    document_id: str,
    body: ChatRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> ChatResponse:
    """RAG-powered chat about a specific document."""
    storage = _storage(request)
    llm_client = _llm(request)
    settings = _settings(request)

    # Verify document and results exist (and that the caller owns them)
    meta = await storage.get_metadata(user_id, document_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")

    result = await storage.get_result(user_id, document_id)
    if not result:
        raise HTTPException(
            status_code=400,
            detail="Document has not been analysed yet. Run /api/analyze first.",
        )

    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    clauses_raw = await storage.get_clauses(user_id, document_id)
    if not clauses_raw:
        clauses_raw = [c.model_dump() for c in result.clauses]

    # Get conversation memory
    memory = getattr(request.app.state, "conversation_memory", None)
    conversation_history: list[dict] = []
    if memory is not None:
        conversation_history = memory.get_history(document_id)

    # Try RAG-powered chat with embedding manager
    embedding_mgr = getattr(request.app.state, "embedding_manager", None)
    if embedding_mgr is not None:
        try:
            from rag.retriever import DocumentRetriever

            retriever = DocumentRetriever(
                embedding_manager=embedding_mgr,
                llm_client=llm_client,
                settings=settings,
            )

            chat_response = await retriever.answer(
                document_id=document_id,
                query=body.message,
                clauses=clauses_raw,
                conversation_history=conversation_history or None,
            )

            # Update conversation memory
            if memory is not None:
                memory.add_message(document_id, "user", body.message)
                memory.add_message(document_id, "assistant", chat_response.answer)

            return chat_response

        except Exception as exc:
            logger.warning(f"RAG chat failed, falling back to direct LLM: {exc}", extra={"status": "rag_fallback"})

    # Fallback: use clauses directly as context
    clause_texts = [
        f"[Clause {c.get('clause_id', '?')}: {c.get('title', '')}] {c.get('text', '')[:300]}"
        for c in clauses_raw[:15]
    ]
    context_text = "\n\n".join(clause_texts)

    chat_config = settings.agent_models.rag_chat
    system_prompt = (
        "You are a legal document assistant for Suits AI. "
        "Answer questions about the document based on the provided clause excerpts. "
        "Be specific, cite clause numbers, and flag any risks. "
        "If the answer is not in the provided context, say so honestly."
    )

    history_block = ""
    if conversation_history:
        history_lines = [f"{t['role'].capitalize()}: {t['content']}" for t in conversation_history]
        history_block = f"Previous conversation:\n" + "\n".join(history_lines) + "\n\n"

    user_message = (
        f"Document clauses:\n{context_text}\n\n"
        f"{history_block}"
        f"User question: {body.message}"
    )

    llm_response = await llm_client.call_with_retry(
        config=chat_config,
        system_prompt=system_prompt,
        user_message=user_message,
    )

    if memory is not None:
        memory.add_message(document_id, "user", body.message)
        memory.add_message(document_id, "assistant", llm_response.text)

    return ChatResponse(answer=llm_response.text, source_clauses=[])


# ── POST /api/chat/{document_id}/stream (streaming document chat) ──────────

@app.post("/api/chat/{document_id}/stream")
async def document_chat_stream(
    document_id: str,
    body: ChatRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> EventSourceResponse:
    """Streaming document-aware chat via SSE."""
    llm_client = _llm(request)
    settings = _settings(request)
    storage = _storage(request)

    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty.")

    meta = await storage.get_metadata(user_id, document_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")

    result = await storage.get_result(user_id, document_id)
    chat_config = settings.agent_models.rag_chat

    # Conversation memory for multi-turn context
    memory = getattr(request.app.state, "conversation_memory", None)
    memory_key = body.conversation_id or document_id
    conversation_history: list[dict] = []
    if memory is not None:
        conversation_history = memory.get_history(memory_key)

    async def event_generator() -> AsyncGenerator[str, None]:
        collected = ""
        try:
            if result:
                # Build context from stored clauses
                clauses_raw = await storage.get_clauses(user_id, document_id)
                if not clauses_raw:
                    clauses_raw = [c.model_dump() for c in result.clauses]

                clause_texts = [
                    f"[Clause {c.get('clause_id', '?')}: {c.get('title', '')}] {c.get('text', '')[:300]}"
                    for c in clauses_raw[:15]
                ]
                context_text = "\n\n".join(clause_texts)

                from prompts.templates import RAG_CHAT_SYSTEM_PROMPT

                system_content = (
                    f"{RAG_CHAT_SYSTEM_PROMPT}\n\n"
                    f"Document clauses for reference:\n{context_text}"
                )

                # Build full message list with history
                messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
                for turn in conversation_history:
                    messages.append({"role": turn["role"], "content": turn["content"]})
                messages.append({"role": "user", "content": body.message})

                async for token in llm_client.call_stream_messages(
                    config=chat_config,
                    messages=messages,
                ):
                    collected += token
                    yield json.dumps({"type": "token", "content": token})

                # Persist to memory after successful response
                if memory is not None:
                    memory.add_message(memory_key, "user", body.message)
                    memory.add_message(memory_key, "assistant", collected)

                # Build source references from the clauses used as context
                source_clauses = [
                    {
                        "clause_id": c.get("clause_id", 0),
                        "title": c.get("title", "Untitled"),
                        "page": c.get("page", 1),
                    }
                    for c in clauses_raw[:15]
                    if c.get("clause_id")
                ]
                yield json.dumps({"type": "done", "source_clauses": source_clauses})
            else:
                from prompts.templates import GENERAL_LEGAL_ADVISOR_PROMPT

                messages_fallback: list[dict[str, str]] = [{"role": "system", "content": GENERAL_LEGAL_ADVISOR_PROMPT}]
                for turn in conversation_history:
                    messages_fallback.append({"role": turn["role"], "content": turn["content"]})
                messages_fallback.append({"role": "user", "content": body.message})

                async for token in llm_client.call_stream_messages(
                    config=chat_config,
                    messages=messages_fallback,
                ):
                    collected += token
                    yield json.dumps({"type": "token", "content": token})

                if memory is not None:
                    memory.add_message(memory_key, "user", body.message)
                    memory.add_message(memory_key, "assistant", collected)

                yield json.dumps({"type": "done", "source_clauses": []})
        except Exception as exc:
            logger.error(f"Stream doc chat failed: {exc}", extra={"status": "chat_error"})
            yield json.dumps({"type": "error", "content": "Failed to generate response."})

    return EventSourceResponse(event_generator())


# ── GET /api/report/{document_id} ───────────────────────────────────────────

@app.get("/api/report/{document_id}")
async def generate_report(
    document_id: str,
    request: Request,
    export_type: str = Query(default="negotiation_brief"),
    user_id: str = Depends(get_current_user_id),
) -> StreamingResponse:
    """Generate and return a PDF report for the given document."""
    storage = _storage(request)
    generator: NegotiationBriefGenerator = request.app.state.report_generator

    meta = await storage.get_metadata(user_id, document_id)
    if not meta:
        raise HTTPException(status_code=404, detail=f"Document {document_id} not found.")

    result = await storage.get_result(user_id, document_id)
    if not result:
        raise HTTPException(
            status_code=400,
            detail="Document has not been analysed yet. Run /api/analyze first.",
        )

    valid_types = {"negotiation_brief", "risk_summary", "clause_report", "full_bundle", "deadlines", "timebombs", "trap_clauses"}
    if export_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid export_type '{export_type}'. Must be one of: {', '.join(sorted(valid_types))}.",
        )

    try:
        pdf_bytes = generator.generate(
            analysis=result,
            metadata=meta,
            export_type=export_type,
        )
    except Exception as exc:
        logger.error(f"PDF generation failed: {exc}", extra={"status": "report_error"}, exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate PDF report.") from exc

    safe_filename = meta.filename.rsplit(".", 1)[0] if "." in meta.filename else meta.filename
    download_name = f"{safe_filename}_{export_type}.pdf"

    return StreamingResponse(
        content=iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{download_name}"'},
    )


# ── POST /api/compare ───────────────────────────────────────────────────────

@app.post("/api/compare")
async def compare_documents(
    body: CompareRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Compare two analysed documents clause-by-clause with risk deltas."""
    storage = _storage(request)

    result_1 = await storage.get_result(user_id, body.document_id_1)
    result_2 = await storage.get_result(user_id, body.document_id_2)

    if not result_1:
        raise HTTPException(status_code=404, detail=f"Results not found for document {body.document_id_1}.")
    if not result_2:
        raise HTTPException(status_code=404, detail=f"Results not found for document {body.document_id_2}.")

    meta_1 = await storage.get_metadata(user_id, body.document_id_1)
    meta_2 = await storage.get_metadata(user_id, body.document_id_2)

    # Build risk maps
    risk_map_1: dict[int, dict] = {}
    for r in result_1.risks:
        risk_map_1[r.clause_id] = r.model_dump()

    risk_map_2: dict[int, dict] = {}
    for r in result_2.risks:
        risk_map_2[r.clause_id] = r.model_dump()

    # Build classification maps
    class_map_1 = {c.clause_id: c.category for c in result_1.classifications}
    class_map_2 = {c.clause_id: c.category for c in result_2.classifications}

    # Clause-by-clause comparison by category
    categories_1: dict[str, list[dict]] = {}
    for clause in result_1.clauses:
        cat = class_map_1.get(clause.clause_id, "Uncategorized")
        categories_1.setdefault(cat, []).append({
            "clause_id": clause.clause_id,
            "title": clause.title,
            "risk": risk_map_1.get(clause.clause_id, {}),
        })

    categories_2: dict[str, list[dict]] = {}
    for clause in result_2.clauses:
        cat = class_map_2.get(clause.clause_id, "Uncategorized")
        categories_2.setdefault(cat, []).append({
            "clause_id": clause.clause_id,
            "title": clause.title,
            "risk": risk_map_2.get(clause.clause_id, {}),
        })

    all_categories = sorted(set(list(categories_1.keys()) + list(categories_2.keys())))

    comparison: list[dict] = []
    for cat in all_categories:
        clauses_1 = categories_1.get(cat, [])
        clauses_2 = categories_2.get(cat, [])

        avg_risk_1 = (
            sum(c["risk"].get("risk_score", 0) for c in clauses_1) / len(clauses_1)
            if clauses_1
            else 0
        )
        avg_risk_2 = (
            sum(c["risk"].get("risk_score", 0) for c in clauses_2) / len(clauses_2)
            if clauses_2
            else 0
        )

        comparison.append({
            "category": cat,
            "document_1_clauses": len(clauses_1),
            "document_2_clauses": len(clauses_2),
            "document_1_avg_risk": round(avg_risk_1, 1),
            "document_2_avg_risk": round(avg_risk_2, 1),
            "risk_delta": round(avg_risk_2 - avg_risk_1, 1),
            "document_1_details": clauses_1,
            "document_2_details": clauses_2,
        })

    # Overall comparison
    overall_1 = result_1.advisory.overall_risk_assessment if result_1.advisory else None
    overall_2 = result_2.advisory.overall_risk_assessment if result_2.advisory else None

    return {
        "document_1": {
            "document_id": body.document_id_1,
            "filename": meta_1.filename if meta_1 else "unknown",
            "total_clauses": len(result_1.clauses),
            "overall_risk": overall_1.model_dump() if overall_1 else None,
        },
        "document_2": {
            "document_id": body.document_id_2,
            "filename": meta_2.filename if meta_2 else "unknown",
            "total_clauses": len(result_2.clauses),
            "overall_risk": overall_2.model_dump() if overall_2 else None,
        },
        "category_comparison": comparison,
        "summary": {
            "categories_only_in_doc1": [
                c for c in categories_1 if c not in categories_2
            ],
            "categories_only_in_doc2": [
                c for c in categories_2 if c not in categories_1
            ],
            "overall_risk_delta": (
                round((overall_2.score if overall_2 else 0) - (overall_1.score if overall_1 else 0), 1)
            ),
        },
    }


# ── GET /api/health ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check(request: Request) -> dict:
    """Return service health and available models. Public — no auth required."""
    settings = _settings(request)

    agent_models = settings.agent_models
    models_info: dict[str, dict[str, str]] = {}
    for agent_name in [
        "segmenter", "classifier", "simplifier", "risk_analyzer",
        "benchmark", "advisor", "verifier", "rag_chat",
    ]:
        cfg = getattr(agent_models, agent_name, None)
        if cfg:
            models_info[agent_name] = {
                "provider": "openrouter",
                "model_id": cfg.model_id,
            }

    return {
        "status": "healthy",
        "service": "Suits AI",
        "version": "1.0.0",
        "auth_enabled": settings.auth_enabled,
        "supabase_configured": settings.supabase_configured,
        "available_models": models_info,
        "config": {
            "max_file_size_mb": settings.max_file_size_mb,
            "max_retries": settings.max_retries,
            "cors_origins": settings.cors_origins,
        },
    }


def _serialise_profile(profile: dict, quota: dict) -> UserResponse:
    """Coerce a profile row (from either backend) into the UserResponse shape."""
    return UserResponse(
        id=str(profile.get("id", "")),
        name=profile.get("name") or "",
        email=profile.get("email"),
        role=profile.get("role") or "individual",
        organization=profile.get("organization") or "",
        use_case=profile.get("use_case") or "",
        jurisdiction=profile.get("jurisdiction") or "India",
        plan=profile.get("plan") or "free",
        documents_used=int(profile.get("documents_used") or 0),
        quota=quota,
    )


# ── GET /api/profile ───────────────────────────────────────────────────────

@app.get("/api/profile", response_model=UserResponse)
async def get_profile(
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> UserResponse:
    """Return the authenticated user's profile and quota."""
    db = _db(request)
    profile = await db.get_or_create_profile(user_id)
    quota = await db.check_quota(user_id)
    return _serialise_profile(profile, quota)


# ── PATCH /api/profile ─────────────────────────────────────────────────────

@app.patch("/api/profile", response_model=UserResponse)
async def update_profile(
    body: UserUpdateRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> UserResponse:
    """Update editable profile fields. Plan/quota are not user-mutable."""
    db = _db(request)
    profile = await db.update_profile(user_id, **body.model_dump(exclude_none=True))
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found.")
    quota = await db.check_quota(user_id)
    return _serialise_profile(profile, quota)


# ── POST /api/onboard ──────────────────────────────────────────────────────
# Kept for the onboarding flow — same contract as PATCH /api/profile but
# accepts the dedicated OnboardingRequest body.

@app.post("/api/onboard", response_model=UserResponse)
async def onboard_user(
    body: OnboardingRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> UserResponse:
    """Persist the onboarding answers onto the authenticated user's profile."""
    db = _db(request)
    await db.get_or_create_profile(user_id, name=body.name)
    profile = await db.update_profile(
        user_id,
        name=body.name,
        role=body.role,
        organization=body.organization,
        use_case=body.use_case,
        jurisdiction=body.jurisdiction,
    )
    if not profile:
        raise HTTPException(status_code=500, detail="Failed to persist profile.")
    quota = await db.check_quota(user_id)
    return _serialise_profile(profile, quota)


# ── GET /api/profile/quota ─────────────────────────────────────────────────

@app.get("/api/profile/quota", response_model=QuotaResponse)
async def check_my_quota(
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> QuotaResponse:
    """Check the authenticated user's remaining document quota."""
    db = _db(request)
    await db.get_or_create_profile(user_id)
    quota = await db.check_quota(user_id)
    return QuotaResponse(**quota)


# ── GET /api/profile/usage ─────────────────────────────────────────────────

@app.get("/api/profile/usage")
async def get_my_usage(
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """Get the authenticated user's document analysis history."""
    db = _db(request)
    return await db.get_usage(user_id)


# ── POST /api/payments/create ──────────────────────────────────────────────

@app.post("/api/payments/create")
async def create_payment(
    body: PaymentCreateRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Create a payment order for plan upgrade."""
    db = _db(request)
    await db.get_or_create_profile(user_id)

    payment = await db.create_payment(user_id=user_id, plan=body.plan)

    return {
        "payment_id": payment["id"],
        "amount_paise": payment["amount_paise"],
        "currency": "INR",
        "plan": body.plan,
        "user_id": user_id,
    }


# ── POST /api/payments/verify ─────────────────────────────────────────────

@app.post("/api/payments/verify")
async def verify_payment(
    body: PaymentVerifyRequest,
    request: Request,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """Verify payment and upgrade the caller's plan.

    NOTE: the Razorpay HMAC signature check (`razorpay_signature` against
    `razorpay_order_id|razorpay_payment_id` with the webhook secret) is NOT
    implemented yet. Do not treat this endpoint as production-secure for
    payments.
    """
    db = _db(request)

    payment = await db.complete_payment(
        payment_id=body.payment_id,
        razorpay_payment_id=body.razorpay_payment_id,
        user_id=user_id,
    )

    if not payment:
        # Either no such payment, or the payment belongs to another user.
        # Return 404 in both cases — leak nothing about cross-user state.
        raise HTTPException(status_code=404, detail="Payment not found.")

    profile = await db.get_profile(user_id)
    quota = await db.check_quota(user_id)

    return {
        "status": "success",
        "plan": payment["plan"],
        "user": _serialise_profile(profile, quota).model_dump() if profile else None,
    }
