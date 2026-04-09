# Suits AI — Full Codebase Audit Report

**Date:** 2026-04-09
**Scope:** Backend (Python/FastAPI), Frontend (React/TypeScript), Infrastructure & Config
**Total Issues Found:** 110+

---

## Table of Contents

1. [Critical Issues (11)](#1-critical-issues)
2. [High Issues (22)](#2-high-issues)
3. [Medium Issues (38)](#3-medium-issues)
4. [Low Issues (40+)](#4-low-issues)
5. [Summary](#5-summary)

---

## 1. Critical Issues

### C1. Live API Key on Disk
- **File:** `/.env` (repo root)
- **Description:** A live OpenRouter API key (`sk-or-v1-...`) exists on disk. While `.gitignore` excludes `.env`, the key is visible to anyone with filesystem access and could be accidentally committed. Should be rotated immediately.

### C2. Missing `aiosqlite` in `requirements.txt`
- **File:** `suits/backend/requirements.txt`
- **Description:** `database.py` imports `aiosqlite`, but it's not listed as a dependency. A fresh `pip install -r requirements.txt` will crash at startup when the database initializes.

### C3. Payment Verification Bypass — No Signature Check
- **File:** `suits/backend/main.py` (payment endpoints) + `suits/backend/database.py:212-242`
- **Description:** `complete_payment` accepts a `razorpay_payment_id` but never verifies the `razorpay_signature` using HMAC. Any attacker can mark any payment as "paid" by guessing/brute-forcing the payment ID. The `PaymentVerifyRequest` model even includes a `razorpay_signature` field that defaults to `""` — it's accepted but never verified.

### C4. Path Traversal via Unsanitized `document_id`
- **Files:** `suits/backend/main.py` (all endpoints using `document_id`), `suits/backend/storage.py:40-41, 69-78, 83-84, 91-92`
- **Description:** None of the Storage methods validate `document_id` before constructing file paths. URL path parameters pass user-supplied strings directly. A malicious `document_id` like `../../.env` would resolve outside the intended directory. `Path(metadata_dir) / "../../.env.json"` resolves to the parent filesystem.

### C5. No Authentication on Any Endpoint
- **File:** `suits/backend/main.py` (all endpoints)
- **Description:** Zero authentication or authorization. All endpoints — including payment, user data, analysis, and admin-level health checks — are publicly accessible. The `user_id` parameter is an optional query param with no verification; anyone can impersonate any user.

### C6. File Upload OOM — Entire File Read Before Size Check
- **File:** `suits/backend/main.py:184-188`
- **Description:** `data = await file.read()` reads the **entire upload** into memory. The size check happens *after*. A malicious user can send a multi-GB file, exhausting server memory before the check rejects it. No streaming size limit middleware exists.

### C7. Abort Does Not Cancel In-Flight SSE Streams (Frontend)
- **File:** `suits/frontend/src/hooks/useAnalysis.ts:96-100`
- **Description:** The `abort()` function sets a flag but the underlying `fetch()` in `analyzeDocumentSSE` has no `AbortController` signal. The stream reader `while(true)` loop continues consuming bandwidth/memory until the server closes the connection. The flag only suppresses state updates, not the network operation.

### C8. No File Type Validation on Document Uploads (Frontend)
- **Files:** `suits/frontend/src/components/chat/ChatInterface.tsx:314-316`, `suits/frontend/src/components/tools/ToolLayout.tsx:436-438`
- **Description:** The `accept` attribute is a UI hint only — never validated in JavaScript before upload. Any file type can be uploaded by bypassing the file picker. Relies entirely on backend validation which is incomplete.

### C9. XSS Risk via Avatar Data URL
- **Files:** `suits/frontend/src/components/settings/SettingsPage.tsx:57`, `suits/frontend/src/context/UserContext.tsx:74`
- **Description:** User avatar is stored as a base64 data URL in `localStorage` and rendered via `<img src>`. No content-type validation beyond file size — only checks size, not that the file is actually an image. `JSON.parse` from `localStorage` on line 74 of UserContext means any script that writes to localStorage can inject arbitrary values. SVGs with embedded JavaScript are a concern if the fallback mechanism changes.

### C10. Frontend-Backend User/Payment API Completely Disconnected
- **Files:** `suits/frontend/src/api/client.ts`, `suits/frontend/src/context/UserContext.tsx`
- **Description:** The backend exposes `POST /api/onboard`, `GET/PATCH /api/user/{user_id}`, `GET /api/user/{user_id}/quota`, payment endpoints — but the frontend has NO client functions for any of them. User data lives entirely in `localStorage`. Onboarding never hits the server. Quota tracking is disconnected. Payment flow endpoints are unreachable from the UI.

### C11. Unbounded Conversation Memory Growth
- **File:** `suits/backend/main.py:680-706`
- **Description:** `ConversationMemory` stores all chat messages in-memory with no eviction or upper bound. `max_turns=10` only limits what's returned, not stored. Over time with many documents and conversations, the server will run out of memory.

---

## 2. High Issues

### H1. No Timeouts on LLM API Calls
- **File:** `suits/backend/llm_client.py:54-62`
- **Description:** `call()` uses `await self.client.chat.completions.create(...)` with no timeout. If the LLM provider hangs, the entire pipeline blocks forever. Critical for a demo — one hung request kills everything.

### H2. No Timeout on Individual Agent Execution
- **File:** `suits/backend/agents/orchestrator.py:122-127, 156-167`
- **Description:** `asyncio.gather` runs parallel agent waves with no `asyncio.wait_for` timeout. Combined with H1, a single hung provider hangs the entire pipeline indefinitely.

### H3. Synchronous File I/O in Async Endpoints
- **File:** `suits/backend/storage.py` (entire file)
- **Description:** All Storage methods use synchronous `path.write_text()`, `path.read_text()`, `glob()`. Called from async FastAPI endpoints, these block the event loop. Under concurrent load: request queuing and latency spikes.

### H4. No Concurrent Access Protection on File Storage
- **File:** `suits/backend/storage.py`
- **Description:** No file locking. Two concurrent `update_status()` calls for the same document create a read-modify-write race. JSON corruption possible.

### H5. `find_by_hash` is O(n) Full Scan
- **File:** `suits/backend/storage.py:47-55`
- **Description:** Every upload triggers a full scan of all metadata JSON files for dedup. Becomes a bottleneck at scale.

### H6. `_safe()` Encoding Destroys Non-Latin-1 Characters in PDF Reports
- **File:** `suits/backend/reports/negotiation_brief.py:74`
- **Description:** `.encode("latin-1", errors="replace").decode("latin-1")` replaces all non-Latin-1 characters with `?`. Indian language text (Devanagari, Tamil), rupee sign `₹`, smart quotes — all destroyed. Critical for an Indian legal document tool.

### H7. Unclosed File Handles in PDF Parser
- **File:** `suits/backend/ingestion/pdf_parser.py:123, 171`
- **Description:** `fitz.open(file_path)` is not in a `with` block or `try/finally`. Exceptions during processing leak file handles.

### H8. `assert` Used for Runtime Check — Stripped in Optimized Mode
- **File:** `suits/backend/database.py:99`
- **Description:** `assert self._db is not None` — Python's `-O` flag strips assertions. The `db` property would return `None`, causing `AttributeError` deep in call stacks.

### H9. SQL Injection Pattern in `update_user`
- **File:** `suits/backend/database.py:152`
- **Description:** Column names are inserted via f-string: `f"UPDATE users SET {set_clause} WHERE id = ?"`. Currently protected by an `allowed` whitelist, but the pattern is fragile. Any change to the allowed set or refactor could introduce SQL injection.

### H10. No Rate Limiting on Any Endpoint
- **File:** `suits/backend/main.py`
- **Description:** No rate limiting middleware. The `/api/chat/stream`, `/api/negotiate/stream`, and `/api/analyze/` endpoints trigger expensive LLM calls. Easy cost amplification attack.

### H11. Greedy Regex in JSON Fallback Parsing
- **File:** `suits/backend/agents/base_agent.py:185`
- **Description:** `(\[[\s\S]*\]|\{[\s\S]*\})` is greedy — matches from first `[`/`{` to LAST `]`/`}`. If the LLM wraps JSON in prose, the regex captures everything including trailing text, producing invalid JSON.

### H12. Verifier Does Not Re-validate Advisory Structure
- **File:** `suits/backend/agents/verifier.py:87-131`
- **Description:** The Verifier can modify `overall_risk_assessment` with invalid `level`/`verdict` values that pass through unvalidated. These invalid values crash `_build_advisory` in the orchestrator, silently nullifying the entire advisory.

### H13. Advisor Missing Validation of Required `overall_risk_assessment` Fields
- **File:** `suits/backend/agents/advisor.py:128-155`
- **Description:** Validation uses `if "score" in ora` — all conditional. If the LLM omits these fields, they pass validation but later crash `_build_advisory` because Pydantic requires `score`, `level`, `verdict`. The entire advisory becomes `None`.

### H14. Prompt Injection via Clause Text
- **File:** `suits/backend/prompts/templates.py` (all agent prompts)
- **Description:** All agents inject clause text directly into prompts via `json.dumps()`. A malicious document containing "IGNORE ALL PREVIOUS INSTRUCTIONS..." can manipulate LLM behavior. No defensive prompt instructions exist.

### H15. Memory Leak: Blob URL Not Revoked in NegotiatorPage
- **File:** `suits/frontend/src/components/tools/NegotiatorPage.tsx:362-367`
- **Description:** `URL.createObjectURL(blob)` creates a blob URL but the `<a>` element is never appended to DOM (unlike the identical pattern in ToolLayout which correctly appends/removes). `URL.revokeObjectURL` is called synchronously after `a.click()`, possibly before download completes.

### H16. Stale Closure in `handleFileSelect`
- **File:** `suits/frontend/src/components/layout/AppLayout.tsx:42-78`
- **Description:** `useCallback` with `[analysis, addDocument]` deps, but `analysis` is recreated every render. Memoization is useless — new function created every render, causing unnecessary downstream re-renders.

### H17. `addDocument` Not Memoized — useEffect Fires Every Render
- **File:** `suits/frontend/src/components/layout/AppLayout.tsx:83-98`
- **Description:** `addDocument` is in the useEffect dependency array but is a new function reference every render. The effect fires on every render cycle, potentially creating duplicate document entries.

### H18. Race Condition: Concurrent Uploads
- **Files:** `suits/frontend/src/components/layout/AppLayout.tsx:42`, `suits/frontend/src/components/tools/ToolLayout.tsx:134`
- **Description:** No cancellation of previous upload/analysis when a new one starts. Both operations race and interleave state updates, leading to unpredictable state.

### H19. Persistent Tool Views Never Unmount — Memory Leak
- **File:** `suits/frontend/src/components/layout/AppLayout.tsx:25-26, 201-229`
- **Description:** `PERSISTENT_TOOL_VIEWS` keeps all visited tool pages mounted (hidden via `display: none`). Each includes SSE streaming, file upload state, chat state, refs. Never unmounted for the app lifetime. No cleanup mechanism.

### H20. Stale Closure in `handleDownloadPDF`
- **File:** `suits/frontend/src/components/tools/ToolLayout.tsx:235-261`
- **Description:** `useCallback` dependencies `[documentId, exportType, downloading]` do NOT include `addDownload` or `filename`. These values are stale if they change between callback creation and invocation.

### H21. `chatSavedRef` Never Updates After Init
- **File:** `suits/frontend/src/components/chat/ChatInterface.tsx:105-107`
- **Description:** `chatSavedRef` is initialized once by checking `chatHistory`. Being a ref, it never updates. If a chat is saved then deleted, the ref still thinks it's saved — title won't be saved properly on next interaction.

### H22. `get_settings()` Not Cached — Re-reads `.env` Every Call
- **File:** `suits/backend/config.py:80-82`
- **Description:** Docstring says "cached" but `return Settings()` creates a new instance every call, re-parsing `.env` each time. No `@lru_cache`.

---

## 3. Medium Issues

### M1. Risk Score Scale Inconsistency (0-10 vs 0-100)
- **Files:** `suits/backend/models.py:52` (no bounds), `suits/backend/reports/negotiation_brief.py` (renders `/100`), `suits/backend/prompts/templates.py` (says 1-10), `suits/frontend/src/components/tools/WhatCouldGoWrongPage.tsx:88` (displays `/100`), `suits/frontend/src/components/tools/TrapDetectorPage.tsx:23` (filters `>= 60`)
- **Description:** The entire codebase is confused about the risk score scale. Prompts say 1-10, utils treat it as 1-10, but PDF reports display `/100` and TrapDetector filters at `>= 60`. Either the PDF/frontend is wrong, or the prompts/utils are wrong. No Pydantic bounds validation on `risk_score`.

### M2. No Bounds Validation on Pydantic Score Fields
- **Files:** `suits/backend/models.py:52` (`risk_score: int`), `:104` (`score: float`), `:38` (`confidence: float`)
- **Description:** `risk_score`, `OverallRiskAssessment.score`, and `confidence` have no `ge`/`le` constraints. LLM hallucinations can produce `risk_score: 9999` or `confidence: -5`.

### M3. No Max Length on `ChatRequest.message` / `NegotiateRequest.message`
- **Files:** `suits/backend/models.py:161, 234`
- **Description:** No length limit. Megabyte-sized messages get forwarded to LLM APIs, causing token limit errors or massive bills. Negotiation is worse — sent to multiple models in multiple rounds.

### M4. `SSEEvent.status` Missing "skipped" Literal
- **File:** `suits/backend/models.py:176`
- **Description:** `AgentTiming.status` includes "skipped" but `SSEEvent.status` only allows "running", "complete", "error", "cached". A skipped agent emitting an SSE event fails Pydantic validation.

### M5. `_safe_parse_list` Silently Drops Items
- **File:** `suits/backend/agents/orchestrator.py:422-438`
- **Description:** Bare `except Exception: continue` silently drops items that don't fit the Pydantic model. A `risk_score` as `"7.5"` (string float) causes the entire item to vanish with no logging.

### M6. No Deduplication of Concurrent Analysis Requests
- **File:** `suits/backend/agents/orchestrator.py:83-263`
- **Description:** Two simultaneous SSE requests for the same `document_id` both pass the cache check and run the full pipeline in parallel, wasting API calls and racing on `storage.save_result`.

### M7. Hallucination Guard Only Checks Two Hardcoded Dict Keys
- **File:** `suits/backend/agents/base_agent.py:238-254`
- **Description:** For dict outputs, only inspects `"critical_issues"` and `"positive_aspects"`. Other lists with `clause_id` references go unchecked.

### M8. Cache Check Treats Empty Classifications as Cache Miss
- **File:** `suits/backend/agents/orchestrator.py:106-113`
- **Description:** `if cached and cached.classifications` — a cached result with zero classifications is treated as a cache miss and re-analyzed.

### M9. Hallucination Warnings Leak Into Downstream Prompts
- **File:** `suits/backend/agents/orchestrator.py:149, 179`
- **Description:** `_hallucination_warning` keys from the hallucination guard are included in the data passed to downstream agents (Risk, Benchmark, Advisor), polluting their LLM prompts with internal metadata.

### M10. Storage Save Failure Leaves Document Stuck in "processing"
- **File:** `suits/backend/agents/orchestrator.py:249-256`
- **Description:** If `save_result` fails, `update_status` is never called. Document is permanently stuck in "processing" status.

### M11. No Coverage Validation in Any Agent
- **Files:** `suits/backend/agents/classifier.py:79-125`, `simplifier.py:60-97`, `risk_analyzer.py`, `benchmark.py`
- **Description:** No agent validates that the LLM returned exactly one result per input clause. Missing clauses or duplicates pass silently, producing incomplete analysis.

### M12. `VALID_RISK_PATTERNS` Defined But Never Used
- **File:** `suits/backend/agents/risk_analyzer.py:19-36, 157-159`
- **Description:** The set exists but flag values are never validated against it. Unknown/hallucinated flags pass through. Dead code suggesting validation was intended but never implemented.

### M13. Unknown `deviation_level` Defaults to "STANDARD"
- **File:** `suits/backend/agents/benchmark.py:104-110`
- **Description:** Dangerous default — a validation failure silently makes a potentially aggressive clause look standard. Should default to something cautious or log at high severity.

### M14. `critical_issues[].clause_id` Defaults to `0`
- **File:** `suits/backend/agents/advisor.py:179`
- **Description:** Clause IDs start at 1. `0` doesn't correspond to any real clause. Frontend may try to look up clause 0 and show incorrect data.

### M15. Advisor Prompt Doesn't Explain Missing Inputs
- **File:** `suits/backend/prompts/templates.py:212-285`
- **Description:** Prompt says "You have received outputs from four specialist agents" but failed agents produce placeholder text. The system prompt doesn't explain this, potentially confusing the LLM.

### M16. `call_stream` / `call_stream_messages` — No Retry, No Fallback, No Timeout
- **File:** `suits/backend/llm_client.py:146-192`
- **Description:** Streaming methods used by negotiation and chat have zero retry logic, no fallback, and no timeout. A single transient error crashes the stream.

### M17. Empty LLM Response Not Treated as Error
- **File:** `suits/backend/llm_client.py:64-65`
- **Description:** Empty `response.choices` returns `text=""`. This propagates to `parse_response` which raises `AgentParseError`. Should be caught at the LLM client level and retried.

### M18. Fallback Call Does Not Retry
- **File:** `suits/backend/llm_client.py:124-141`
- **Description:** When the primary model fails and fallback is tried, the fallback gets exactly one attempt with no retries.

### M19. `close()` Does Not Reset `_client` to None
- **File:** `suits/backend/llm_client.py:196-198`
- **Description:** After `await self._client.close()`, the `client` property guard `if self._client is None` won't trigger. Subsequent calls use the closed client.

### M20. `root.handlers.clear()` Removes All Existing Handlers
- **File:** `suits/backend/logging_config.py:37`
- **Description:** Clears ALL handlers from the root logger including uvicorn's access logging handlers.

### M21. OCR Renders Every Page at 300 DPI Regardless of Size
- **File:** `suits/backend/ingestion/pdf_parser.py:178-179`
- **Description:** Large-format pages (A1, A0) at 300 DPI produce images of hundreds of MB. No memory guard.

### M22. PIL `Image.open()` Not Closed After OCR
- **Files:** `suits/backend/ingestion/pdf_parser.py:181`, `suits/backend/ingestion/image_parser.py:32`
- **Description:** Image file handles never explicitly closed. Accumulates memory in loops.

### M23. Entire Document Sent to LLM for "Small" Docs (15K Words)
- **File:** `suits/backend/ingestion/clause_segmenter.py:116-117`
- **Description:** Documents under 15,000 words sent whole — ~60K characters. Could exceed token limits for some models with no fallback to chunking.

### M24. RAG Chat Doesn't Limit Conversation History Size in Prompt
- **File:** `suits/backend/rag/retriever.py:280-288`
- **Description:** Entire conversation history serialized into the prompt. 10 turns of long responses could exceed context window.

### M25. ChromaDB Collections Never Cleaned Up
- **File:** `suits/backend/rag/embeddings.py`
- **Description:** Collections created via `get_or_create_collection` but never deleted when documents are deleted. In-memory ChromaDB grows unbounded.

### M26. SentenceTransformer Model Loaded Synchronously
- **File:** `suits/backend/rag/embeddings.py:27`
- **Description:** `SentenceTransformer(model)` blocks the event loop if called outside `asyncio.to_thread()`. Currently handled in `main.py` lifespan, but fragile if instantiated elsewhere.

### M27. No Per-Document Conversation Size Limit
- **File:** `suits/backend/rag/conversation.py:38-42`
- **Description:** Messages appended with no upper bound. All retained in memory until explicit `clear()`.

### M28. `_load_rag` Background Task Errors Silently Swallowed
- **File:** `suits/backend/main.py:102`
- **Description:** `asyncio.create_task(_load_rag())` — exceptions silently lost. Server continues with `embedding_manager = None`. Task reference not stored, could be GC'd.

### M29. Weak Filename Sanitization
- **File:** `suits/backend/main.py:214`
- **Description:** Only replaces `/` and `\`. Doesn't handle null bytes, special characters, extremely long filenames, or Unicode normalization attacks.

### M30. CORS Missing `expose_headers`
- **File:** `suits/backend/main.py:122-131`
- **Description:** No `expose_headers` set. Frontend can't read custom response headers (e.g., `Content-Disposition`) in cross-origin scenarios.

### M31. `.env.example` Documents Non-Existent `PROVIDER` Fields
- **File:** `suits/.env.example:13-26`
- **Description:** Example keys like `AGENT_MODELS__CLASSIFIER__PROVIDER=openrouter` reference a field that doesn't exist on `ModelConfig`. Silently ignored, misleading.

### M32. `record_usage` Race Condition
- **File:** `suits/backend/database.py:163-167`
- **Description:** Separate `INSERT` and `UPDATE` not in a single transaction. Crash between them leaves inconsistent state.

### M33. `create_user` Silently Returns Existing User
- **File:** `suits/backend/database.py:118-119`
- **Description:** On email collision, returns existing user without updating fields. Caller can't distinguish new vs existing.

### M34. No React Error Boundaries
- **Files:** `suits/frontend/src/App.tsx`, `suits/frontend/src/main.tsx`
- **Description:** Zero error boundaries. Any render exception (e.g., null access from malformed API data) crashes the entire app to white screen.

### M35. `UserProvider` Functions Not Memoized
- **File:** `suits/frontend/src/context/UserContext.tsx:140-177`
- **Description:** `addChat`, `removeChat`, `addDocument`, `addDownload` recreated every render. Every `useUser()` consumer re-renders on any state change.

### M36. Silent Download Failures
- **Files:** `suits/frontend/src/components/analysis/ResultsDashboard.tsx:126-127`, `suits/frontend/src/components/tools/DownloadsPage.tsx:25`, `suits/frontend/src/components/tools/ToolLayout.tsx:257`
- **Description:** Multiple download handlers have empty catch blocks. User gets no error feedback — button shows "Generating..." then resets silently.

### M37. `navigator.clipboard.writeText` Without Error Handling
- **File:** `suits/frontend/src/components/chat/ChatMessage.tsx:55`
- **Description:** Can throw in insecure contexts (HTTP) or when document doesn't have focus. Unhandled promise rejection.

### M38. Multiple `setTimeout` Callbacks Not Cleaned Up on Unmount
- **Files:** `suits/frontend/src/components/splash/SplashScreen.tsx:19`, `suits/frontend/src/components/onboarding/OnboardingFlow.tsx:123`, `suits/frontend/src/components/settings/SettingsPage.tsx:68`, `suits/frontend/src/components/chat/ChatMessage.tsx:57`
- **Description:** `setTimeout` used without storing timer IDs. Can call setState on unmounted components.

---

## 4. Low Issues

### L1. `anthropic` SDK in Requirements But Never Used
- **File:** `suits/backend/requirements.txt:4`

### L2. No Pinned Upper Bounds on Dependencies
- **File:** `suits/backend/requirements.txt`

### L3. `clause_id` Type Not Coerced to Int in Validation
- **Files:** `suits/backend/agents/classifier.py:92-95`, `suits/backend/agents/base_agent.py:224, 243`
- **Description:** LLM may return `"5"` (string) instead of `5` (int). Comparison `"5" not in {5}` triggers false hallucination warnings.

### L4. Markdown Fence Stripping Only Handles Start-of-String
- **File:** `suits/backend/agents/base_agent.py:171`
- **Description:** Regex `^``` ``` only matches fences at beginning. Fences preceded by text aren't stripped.

### L5. `simplifier.original_length` Defaults to 0
- **File:** `suits/backend/agents/simplifier.py:84-85`

### L6. Risk Score Silently Clamped Without Warning
- **File:** `suits/backend/agents/risk_analyzer.py:125`
- **Description:** `max(1, min(10, score))` silently clamps. Score of 15 becomes 10 with no log.

### L7. Advisor `critical_issues` Non-Dict Items Silently Ignored
- **File:** `suits/backend/agents/advisor.py:175-184`

### L8. Advisor Prompt Says "Four Agents" But Verifier May Modify
- **File:** `suits/backend/prompts/templates.py`

### L9. Duplicate `RAG_CHAT_SYSTEM_PROMPT` Definition
- **File:** `suits/backend/rag/retriever.py:28-37` vs `suits/backend/prompts/templates.py:348`
- **Description:** Violates project rule "All prompts live in `prompts/templates.py`."

### L10. Sentence Splitting Regex Misses Lowercase Starts
- **File:** `suits/backend/rag/chunker.py:23`
- **Description:** `(?<=[.!?])\s+(?=[A-Z])` only splits on uppercase next sentence. Legal text often starts lowercase.

### L11. UUID Truncated to 16 Hex Chars (64 bits)
- **File:** `suits/backend/database.py:113, 159, 200`

### L12. `response.model` May Not Match Actual Model
- **File:** `suits/backend/llm_client.py:71`
- **Description:** Falls back to requested model ID, but OpenRouter may use a different model.

### L13. `call_with_retry` Doesn't Handle `APIConnectionError`
- **File:** `suits/backend/llm_client.py:103-107`
- **Description:** Network timeouts and DNS failures are transient but not retried.

### L14. Fixed Set of Extra Fields in JSON Logger
- **File:** `suits/backend/logging_config.py:24`
- **Description:** Only extracts hardcoded keys. Other `extra={}` fields silently dropped.

### L15. `setup_logging()` Not Idempotent
- **File:** `suits/backend/logging_config.py:31-45`

### L16. All Logs Go to `stdout` Instead of `stderr` for Errors
- **File:** `suits/backend/logging_config.py:39`

### L17. No Timeout on pytesseract OCR
- **File:** `suits/backend/ingestion/pdf_parser.py:184`

### L18. No Image Size Validation Before OCR
- **File:** `suits/backend/ingestion/image_parser.py`

### L19. JSON Fallback Regex in Clause Segmenter is Greedy
- **File:** `suits/backend/ingestion/clause_segmenter.py:161`

### L20. PDF Table Rows Fixed at 6mm — Long Text Truncated
- **File:** `suits/backend/reports/negotiation_brief.py:302-324, 426-463`

### L21. `_RISK_LEVEL_ORDER` Defined But Never Used in Report
- **File:** `suits/backend/reports/negotiation_brief.py:39`

### L22. Health Check Exposes Internal Config
- **File:** `suits/backend/main.py:980-1021`
- **Description:** Returns CORS origins, model IDs — could aid reconnaissance.

### L23. `_add_cors` Calls `get_settings()` at Module Import Time
- **File:** `suits/backend/main.py:122-133`

### L24. `openrouter_api_key` Defaults to Empty String
- **File:** `suits/backend/config.py:54`
- **Description:** Server starts with empty key, all LLM calls fail at runtime.

### L25. `AppView` Type Union Includes `| string` — Defeats Type Safety
- **File:** `suits/frontend/src/components/layout/AppLayout.tsx:22`
- **Description:** `type AppView = 'chat' | 'uploading' | ... | string` — the `| string` makes all specific literals meaningless.

### L26. Duplicate `ChatMessage` Interface Definitions
- **Files:** `suits/frontend/src/context/UserContext.tsx:12-16`, `suits/frontend/src/hooks/useChat.ts:4-9`
- **Description:** Two different shapes in different files.

### L27. Accessibility: No ARIA Labels on Interactive Elements
- **Files:** Sidebar nav buttons, chat delete `<span role="button">`, upload drop zones, file inputs, textarea
- **Description:** Missing `aria-current`, `aria-label`, `role="button"`, `aria-expanded` across the app.

### L28. Accessibility: Keyboard Navigation Broken for Collapsed Sidebar
- **File:** `suits/frontend/src/components/layout/Sidebar.tsx`
- **Description:** Collapsed sections remove buttons from DOM. No skip-nav or `aria-expanded`.

### L29. Animation Delay Scales Linearly with Message Index
- **File:** `suits/frontend/src/components/chat/ChatMessage.tsx:65`
- **Description:** `delay: index * 0.05` — message 100 waits 5 seconds. Should be capped.

### L30. Hardcoded Model Names in NegotiatorPage
- **File:** `suits/frontend/src/components/tools/NegotiatorPage.tsx:692, 739`
- **Description:** "Gemini Flash" and "GPT-4o Mini" hardcoded. Will be wrong if backend config changes.

### L31. Hardcoded Backend Port in Vite Proxy
- **File:** `suits/frontend/vite.config.ts:17`

### L32. Scrollbar Styles Only Target WebKit
- **File:** `suits/frontend/src/styles/index.css:83-98`
- **Description:** Missing `scrollbar-width`/`scrollbar-color` for Firefox.

### L33. `extractDeadlines` Runs on Every Render Without `useMemo`
- **File:** `suits/frontend/src/components/tools/DeadlineTrackerPage.tsx:7-38`

### L34. `findTimebombs` / `findTraps` Not Memoized
- **Files:** `suits/frontend/src/components/tools/TimebombPage.tsx:54`, `TrapDetectorPage.tsx:47`

### L35. Large Base64 Avatar Stored in localStorage
- **File:** `suits/frontend/src/components/settings/SettingsPage.tsx:59`
- **Description:** ~2.7MB base64 string. Combined with chat history, approaches localStorage's 5MB limit.

### L36. `useChat` Stale Closure Over `documentId`
- **File:** `suits/frontend/src/hooks/useChat.ts:12, 17`

### L37. `getResults` Promise Not Guarded Against Unmount
- **File:** `suits/frontend/src/components/layout/AppLayout.tsx:133-141`

### L38. `gitignore` Missing `node_modules/` at Root Level
- **File:** `/.gitignore`

### L39. No TypeScript `strict` Mode
- **File:** `suits/frontend/tsconfig.app.json`

### L40. No Docker/CI-CD Configuration
- **Description:** Manual deployment only. Acceptable for hackathon.

---

## 5. Summary

| Severity | Count | Top Concern |
|----------|-------|-------------|
| **Critical** | 11 | Payment bypass, path traversal, no auth, OOM on upload, disconnected frontend-backend |
| **High** | 22 | No timeouts, sync I/O in async, file handle leaks, race conditions, prompt injection |
| **Medium** | 38 | Risk score confusion, missing validation, memory leaks, no error boundaries |
| **Low** | 40+ | Dead code, accessibility, type safety gaps, missing memoization |
| **Total** | **110+** | |

### Top 10 Most Urgent (Demo/Security Impact)

| # | Issue | Risk |
|---|-------|------|
| 1 | **C3** Payment verification bypass | Anyone can mark payments as "paid" |
| 2 | **C4** Path traversal via `document_id` | Arbitrary file read on server |
| 3 | **C5** No authentication | All data publicly accessible |
| 4 | **C6** OOM on large file upload | Server crash via single request |
| 5 | **H1+H2** No LLM call timeouts | Demo hangs forever on provider hiccup |
| 6 | **C10** Frontend-backend user API disconnected | Onboarding/quota/payment never work |
| 7 | **M1** Risk score scale confusion (1-10 vs 0-100) | Wrong data shown to users |
| 8 | **H14** Prompt injection via clause text | Malicious docs manipulate analysis |
| 9 | **H6** PDF report destroys Indian text | Unusable for target market |
| 10 | **C11** Unbounded memory growth | Server OOM over time |
