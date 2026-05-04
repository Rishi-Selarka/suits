# Suits AI — Legal Document Analysis Platform

> Multi-agent AI system that reads legal documents in seconds. Upload a contract — get clause-level risk scores, plain-English explanations, fair-market benchmark comparisons, and a verified negotiation playbook.

Built for the **RNSIT Agentic AI Hackathon (Problem Statement 3)**.

---

## What It Does

Most people sign contracts they don't fully understand. Suits AI reads them so you don't have to.

Upload any legal document (rental agreement, employment contract, NDA, freelance contract, SaaS ToS) and a pipeline of specialized agents collaborates to produce:

- **Risk heatmap** — every clause color-coded by severity (green / yellow / red)
- **Plain-English simplifications** — legalese rewritten for a non-lawyer
- **Benchmark comparisons** — how your contract stacks up against fair-standard baselines
- **Verdict** — SIGN / NEGOTIATE / WALK AWAY with reasoning
- **Negotiation playbook** — priority-ordered issues with suggested counter-language
- **Document comparison** — diff two versions of a contract clause-by-clause
- **Negotiation simulator** — two AI agents role-play a redline conversation
- **Interactive chat** — ask questions about your document (multi-turn, RAG-grounded)
- **Downloadable PDF** — professional negotiation brief to share with your lawyer

---

## Agent Pipeline

Six agents run in a DAG with parallel waves, cutting total latency vs. sequential execution:

```
Wave 1 (parallel)
├── Classifier      — categorizes each clause
└── Simplifier      — plain-English rewrite

Wave 2 (parallel, needs Classifier)
├── Risk Analyzer   — risk score + flags per clause
└── Benchmark       — deviation from fair standard

Wave 3 (sequential)
├── Advisor         — synthesizes everything → final report
└── Verifier        — critique + hallucination check + cross-clause interaction
```

The Verifier implements a **generate → critique → refine** loop: it cross-checks every number, date, and clause reference against the source text before the report is finalized. The `BaseAgent` hallucination guard also independently audits each agent's output against the source clauses.

Two additional agents power the negotiation simulator (`negotiator_agent1` + `negotiator_agent2`), and a RAG chat agent answers free-form questions grounded in the document.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI (Python 3.11+), async throughout |
| LLM Provider | **OpenRouter** (OpenAI-compatible) — single client, any model |
| Auth | Supabase Auth (asymmetric JWT verified via JWKS, with HS256 fallback) |
| Database | Supabase Postgres (RLS-enforced) — local SQLite fallback for dev |
| File Storage | Supabase Storage (per-user buckets, signed URLs) — local FS fallback for dev |
| PDF Parsing | PyMuPDF + pytesseract OCR fallback |
| RAG | sentence-transformers + ChromaDB (in-memory; opt-in via `ENABLE_RAG`) |
| PDF Reports | fpdf2 |
| Config | pydantic-settings + `.env` |
| Frontend | React 18 + TypeScript + Vite + Supabase JS |
| Streaming | SSE (Server-Sent Events) for real-time agent progress |

All LLM traffic is routed through OpenRouter — there is no direct Anthropic or OpenAI SDK call from the agents. Per-agent model selection is config-driven, so swapping `anthropic/claude-sonnet-4-5` for `openai/gpt-4o` or `google/gemini-2.0-flash` requires only an env var.

---

## Project Structure

```
suits/
├── backend/
│   ├── main.py                  # FastAPI app, all routes, SSE streaming
│   ├── config.py                # Pydantic settings, per-agent model config
│   ├── models.py                # All Pydantic request/response models
│   ├── llm_client.py            # OpenRouter async client (retry, fallback)
│   ├── auth.py                  # Supabase JWT verification (JWKS + HS256)
│   ├── database.py              # Postgres / SQLite abstraction
│   ├── storage.py               # Supabase Storage / local FS abstraction
│   ├── supabase_client.py       # Service-role Supabase client
│   ├── supabase_schema.sql      # Tables, RLS policies, storage policies
│   ├── agents/
│   │   ├── orchestrator.py      # DAG runner — parallel waves, retries
│   │   ├── base_agent.py        # Abstract base + hallucination guard
│   │   ├── classifier.py
│   │   ├── simplifier.py
│   │   ├── risk_analyzer.py
│   │   ├── benchmark.py
│   │   ├── advisor.py
│   │   └── verifier.py
│   ├── ingestion/               # PDF parser + OCR + clause segmenter
│   ├── rag/                     # Hybrid search, embeddings, conversation memory
│   ├── reports/                 # PDF report generation (negotiation brief)
│   └── prompts/templates.py     # All agent prompts (centralized)
├── frontend/                    # React + TypeScript + Vite
├── sample_docs/                 # Demo documents
└── data/                        # Local-dev uploads + cached results (gitignored)
```

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Tesseract OCR: `brew install tesseract` (macOS) or `sudo apt-get install tesseract-ocr` (Ubuntu)
- An [OpenRouter](https://openrouter.ai) API key
- (Optional) A [Supabase](https://supabase.com) project — without it, the app runs in single-user dev mode with local file storage

### Backend

```bash
cd suits/backend

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt

# Create .env at the project root
cp suits/.env.example .env
# Add your OPENROUTER_API_KEY (and Supabase keys if using)

uvicorn main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs`.

### Frontend

```bash
cd suits/frontend
npm install
npm run dev                     # Runs at http://localhost:5173
```

Or run both together:

```bash
cd suits/frontend
npm run dev:all
```

### Supabase (optional)

Auth, persistent storage, and per-user quotas are gated behind Supabase. Without it, the backend runs in single-user dev mode and writes to the local filesystem.

Full setup walk-through: [`suits/SETUP_SUPABASE.md`](./suits/SETUP_SUPABASE.md). It covers creating the project, applying `supabase_schema.sql`, configuring the `documents` storage bucket, enabling email + Google OAuth, and grabbing the four required keys.

### Environment Variables

```bash
# Required
OPENROUTER_API_KEY=sk-or-...

# Supabase (leave blank for local dev — auth disabled, local FS storage)
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...    # backend only — never expose to browser
SUPABASE_JWT_SECRET=...                 # legacy HS256; not needed for newer asymmetric-key projects
SUPABASE_STORAGE_BUCKET=documents

# Server
LOG_LEVEL=INFO
MAX_FILE_SIZE_MB=20
CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]

# Memory tuning — disable RAG embeddings on small instances (e.g. Render free tier)
ENABLE_RAG=true

# Per-agent model overrides (any OpenRouter-supported model)
AGENT_MODELS__CLASSIFIER__MODEL_ID=anthropic/claude-sonnet-4-5
AGENT_MODELS__RISK_ANALYZER__MODEL_ID=openai/gpt-4o
AGENT_MODELS__RISK_ANALYZER__FALLBACK_MODEL_ID=anthropic/claude-3.5-sonnet
AGENT_MODELS__ADVISOR__MODEL_ID=anthropic/claude-opus-4-5
# ... see suits/.env.example for the full list
```

The frontend reads its own `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `suits/frontend/.env`.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload PDF/PNG/JPG/TXT (max 20MB). Returns `document_id`. SHA-256 dedup. |
| `POST` | `/api/analyze/{document_id}` | Run the agent pipeline. SSE stream with per-agent progress. |
| `GET`  | `/api/results/{document_id}` | Fetch complete analysis JSON. |
| `POST` | `/api/negotiate/stream` | Two-agent negotiation simulator (SSE). |
| `POST` | `/api/chat` | General-purpose legal chat (no document context). |
| `POST` | `/api/chat/{document_id}` | Document-grounded chat (RAG-backed, multi-turn). |
| `POST` | `/api/chat/{document_id}/stream` | Streaming variant of document chat. |
| `POST` | `/api/compare` | Diff two document versions clause-by-clause. |
| `GET`  | `/api/report/{document_id}` | Download negotiation brief as PDF. |
| `GET`  | `/api/profile` | Authenticated user's profile. |
| `PATCH`| `/api/profile` | Update profile fields. |
| `POST` | `/api/onboard` | Complete first-run onboarding. |
| `GET`  | `/api/profile/quota` | Current usage vs. plan limits. |
| `GET`  | `/api/profile/usage` | Detailed usage history. |
| `POST` | `/api/payments/create` | Create a Razorpay order (Pro upgrade). |
| `POST` | `/api/payments/verify` | Verify Razorpay payment signature. |
| `GET`  | `/api/health` | Service status + configured models. |

SSE event format:
```json
{ "agent": "risk_analyzer", "status": "complete", "timing_ms": 3200, "model_used": "openai/gpt-4o" }
```

All endpoints except `/api/health` require a Supabase JWT in `Authorization: Bearer <token>` when Supabase is configured. With Supabase unset, requests fall through to a development user ID.

---

## Key Design Decisions

- **Single LLM transport, many models.** Routing every call through OpenRouter means each agent picks the model best suited to its task — fast/cheap for classification, strong reasoning for risk and advisor, language-heavy models for simplification — without juggling multiple SDKs.
- **Jurisdiction-aware.** Risk and Benchmark agents are calibrated for Indian legal context (Section 27 non-compete enforceability, 11-month lease structures, Rent Control Acts, Shops & Establishments Act).
- **Fault-tolerant pipeline.** Classifier failure halts the run (downstream agents depend on its output); every other agent fails gracefully and the report is generated from whatever succeeded.
- **Hallucination guard.** `BaseAgent` cross-checks every `clause_id` and number in agent output against the source before saving. The Verifier independently audits the Advisor's entire report.
- **RLS everywhere.** When Supabase is on, every Postgres table and every Storage object is scoped by `user_id` via RLS — the backend uses the service-role key but the schema enforces tenant isolation.
- **Deduplication.** Uploads are keyed by SHA-256 — re-uploading a contract returns the cached analysis instantly.

---

## Disclaimer

Suits AI is an analytical tool, **not legal advice**. All outputs should be reviewed by a qualified lawyer before acting on them.
