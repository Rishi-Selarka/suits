# LegalLens AI — Project Rules

## Project Overview
LegalLens AI is a multi-agent, multi-model legal document analysis platform. It uses 6 specialized AI agents orchestrated in a DAG to analyze legal documents and produce risk assessments, plain-English simplifications, benchmark comparisons, negotiation playbooks, and a verified final report with cross-clause interaction checks.

## Tech Stack
- **Backend**: Python 3.11+ / FastAPI
- **LLM Providers**: Anthropic (direct) + OpenRouter (GPT-4o, GPT-4o-mini, Gemini, etc.)
- **PDF Parsing**: PyMuPDF + pytesseract OCR fallback
- **RAG**: sentence-transformers + ChromaDB (in-memory)
- **PDF Reports**: fpdf2
- **Config**: pydantic-settings with .env

## Architecture
- Multi-model: Each agent uses a different AI model optimized for its task
- Multi-provider: Anthropic SDK for Claude, OpenAI SDK for OpenRouter
- DAG orchestration with 3 parallel waves + verification step
- Hallucination guard in BaseAgent cross-checks clause_ids and numbers against source
- Jurisdiction-aware analysis (Indian legal context: Rent Control Acts, Section 27, Shops & Establishments)
- SSE streaming for real-time agent progress
- File-based storage (JSON) — no database

## Code Conventions
- Use `async/await` throughout — all LLM calls are async
- All agent prompts live in `backend/prompts/templates.py` (centralized)
- All Pydantic models live in `backend/models.py`
- Config via `backend/config.py` using pydantic-settings
- LLM calls go through `backend/llm_client.py` — never call Anthropic/OpenAI SDKs directly from agents
- Use structured logging via `backend/logging_config.py`

## File Layout
```
legallens/backend/     — All backend code
legallens/data/        — Runtime data (uploads, results, metadata)
legallens/sample_docs/ — Demo documents
```

## Key Rules
- Never hardcode API keys — always use .env via config.py
- Never commit .env files — only .env.example
- All agents must inherit from BaseAgent in base_agent.py
- Agent responses must be validated via validate_response()
- Always handle partial agent failures gracefully
- Use asyncio.gather for parallel agent execution in waves
- SSE events must include agent name, status, timing_ms, and model_used

## Testing
- Run backend: `cd legallens/backend && uvicorn main:app --reload --port 8000`
- API docs: http://localhost:8000/docs
- Test upload: POST /api/upload with a PDF
- Test analysis: POST /api/analyze/{document_id} (SSE stream)

## Important Files
- `suits.md` — Complete technical specification (source of truth)
- `legallens/backend/llm_client.py` — Multi-provider LLM abstraction (critical)
- `legallens/backend/agents/orchestrator.py` — DAG execution engine (critical)
- `legallens/backend/config.py` — All configuration (critical)
