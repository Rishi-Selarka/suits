# Suits AI — Legal Document Analysis Platform

> Multi-agent, multi-model AI system that analyzes legal documents in seconds. Upload a contract — get risk scores, plain-English explanations, benchmark comparisons, and a negotiation playbook.

Built for the **RNSIT Agentic AI Hackathon (Problem Statement 3)**.

---

## What It Does

Most people sign contracts they don't fully understand. Suits AI reads them so you don't have to.

Upload any legal document (rental agreement, employment contract, NDA, freelance contract, SaaS ToS) and six specialized AI agents collaborate to produce:

- **Risk heatmap** — every clause color-coded by severity (green / yellow / red)
- **Plain-English simplifications** — legalese rewritten for a non-lawyer
- **Benchmark comparisons** — how your contract stacks up against fair-standard baselines
- **Verdict** — SIGN / NEGOTIATE / WALK AWAY with reasoning
- **Negotiation playbook** — priority-ordered issues with suggested counter-language
- **Interactive chat** — ask questions about your document (multi-turn, grounded answers)
- **Downloadable PDF** — professional negotiation brief to share with your lawyer

---

## Agent Pipeline

Six agents run in a DAG with parallel waves, cutting total latency ~40% vs. sequential:

```
Wave 1 (parallel)
├── Classifier      — GPT-4o-mini via OpenRouter   (categorizes each clause)
└── Simplifier      — Claude Sonnet 4.6 (Anthropic) (plain-English rewrite)

Wave 2 (parallel, needs Classifier)
├── Risk Analyzer   — GPT-4o via OpenRouter         (risk score + flags per clause)
└── Benchmark       — GPT-4o via OpenRouter         (deviation from fair standard)

Wave 3 (sequential)
├── Advisor         — Claude Sonnet 4.6 (Anthropic) (synthesizes everything → final report)
└── Verifier        — Claude Sonnet 4.6 (Anthropic) (critique + hallucination check + cross-clause)
```

The Verifier implements a **generate → critique → refine** loop: it cross-checks every number, date, and clause reference against the source text before the report is finalized.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend API | FastAPI (Python 3.11+), async throughout |
| LLM — Anthropic | `anthropic` SDK (`AsyncAnthropic`) |
| LLM — OpenRouter | `openai` SDK pointed at `openrouter.ai/api/v1` |
| PDF Parsing | PyMuPDF + pytesseract OCR fallback |
| RAG | sentence-transformers + ChromaDB (in-memory) |
| PDF Reports | fpdf2 |
| Config | pydantic-settings + `.env` |
| Frontend | React 18 + TypeScript + Vite |
| Streaming | SSE (Server-Sent Events) for real-time agent progress |

---

## Project Structure

```
suits/
├── backend/
│   ├── main.py                  # FastAPI app, all routes, SSE streaming
│   ├── config.py                # Pydantic settings, per-agent model config
│   ├── models.py                # All Pydantic request/response models
│   ├── llm_client.py            # Unified multi-provider LLM client (critical)
│   ├── storage.py               # File-based JSON storage
│   ├── agents/
│   │   ├── orchestrator.py      # DAG runner — parallel waves, retries (critical)
│   │   ├── base_agent.py        # Abstract base + hallucination guard
│   │   ├── classifier.py
│   │   ├── simplifier.py
│   │   ├── risk_analyzer.py
│   │   ├── benchmark.py
│   │   ├── advisor.py
│   │   └── verifier.py
│   ├── ingestion/               # PDF parser + OCR + clause segmenter
│   ├── rag/                     # Hybrid search, embeddings, conversation memory
│   ├── reports/                 # PDF report generation
│   └── prompts/templates.py     # All agent prompts (centralized)
├── frontend/                    # React + TypeScript + Vite
├── sample_docs/                 # Demo documents
└── data/                        # Runtime uploads + cached results (gitignored)
```

---

## Setup

### Prerequisites

- Python 3.11+
- Node.js 18+
- Tesseract OCR: `brew install tesseract` (macOS) or `sudo apt-get install tesseract-ocr` (Ubuntu)
- API keys for [Anthropic](https://console.anthropic.com) and [OpenRouter](https://openrouter.ai)

### Backend

```bash
cd suits/backend

python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

pip install -r requirements.txt

# Create .env from template
cp .env.example .env
# Add your ANTHROPIC_API_KEY and OPENROUTER_API_KEY

uvicorn main:app --reload --port 8000
```

API docs available at `http://localhost:8000/docs`

### Frontend

```bash
cd suits/frontend
npm install
npm run dev                     # Runs at http://localhost:5173
```

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...

# Optional — override any agent's model without code changes
AGENT_MODELS__CLASSIFIER__MODEL_ID=openai/gpt-4o-mini
AGENT_MODELS__RISK_ANALYZER__MODEL_ID=openai/gpt-4o
AGENT_MODELS__ADVISOR__MODEL_ID=claude-sonnet-4-6-20260217
# ... (see suits.md for full list)
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload PDF/PNG/JPG/TXT (max 20MB). Returns `document_id`. SHA-256 dedup. |
| `POST` | `/api/analyze/{document_id}` | Run the agent pipeline. Returns SSE stream with per-agent progress. |
| `GET` | `/api/results/{document_id}` | Fetch complete analysis JSON. |
| `POST` | `/api/chat/{document_id}` | Ask a question about the document (RAG-backed, multi-turn). |
| `GET` | `/api/report/{document_id}` | Download negotiation brief as PDF. |
| `GET` | `/api/health` | Service status + available models. |

SSE events format:
```json
{ "agent": "risk_analyzer", "status": "complete", "timing_ms": 3200, "model_used": "openai/gpt-4o" }
```

---

## Key Design Decisions

- **Multi-model**: Each agent uses the model best suited for its task — fast/cheap models for classification, deep-reasoning models for risk analysis, Claude for language-heavy tasks.
- **Jurisdiction-aware**: Risk and Benchmark agents are calibrated for Indian legal context (Section 27 non-compete enforceability, 11-month lease structures, Rent Control Act, Shops & Establishments Act).
- **Fault-tolerant**: Classifier failure blocks the pipeline; all other agents fail gracefully — partial results are shown with an option to retry.
- **Hallucination guard**: `BaseAgent` cross-checks every `clause_id` and number in agent output against the source before saving. The Verifier also independently audits the Advisor's entire report.
- **No database**: Results cached as JSON files, keyed by SHA-256 document hash. Duplicate uploads return cached results instantly.

---

## Disclaimer

Suits AI is an analytical tool, **not legal advice**. All outputs should be reviewed by a qualified lawyer before acting on them.
