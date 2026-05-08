# LegalLens AI — Complete Technical Specification (Enhanced)

> **Purpose**: This document is the single source of truth for building LegalLens AI, a multi-agent, multi-model legal document analysis platform for the RNSIT Agentic AI hackathon (Problem Statement 3). The system uses multiple AI providers (Anthropic + OpenRouter) with different models optimized per agent.

---

## 1. Project Overview

**LegalLens AI** is an agentic system that takes any legal document (rental agreements, employment contracts, NDAs, terms of service, freelance contracts) and autonomously analyzes it using six specialized AI agents orchestrated in a dependency graph. The output is a comprehensive, interactive risk analysis with plain-English explanations, benchmark comparisons, and an actionable negotiation playbook — with a built-in verification layer to catch hallucinations and cross-clause issues.

### What Makes This "Agentic"
- **Autonomous decision-making**: The system decides how to segment clauses, what risk patterns to flag, and what final verdict to give — without human intervention between steps.
- **Multi-agent collaboration**: Six agents with distinct roles pass structured outputs to each other via a DAG (Directed Acyclic Graph) orchestrator.
- **Self-directed analysis depth**: The Risk Analyzer agent autonomously decides whether a clause needs shallow or deep analysis based on the Classifier's output.
- **Multi-model intelligence**: Each agent uses a different AI model chosen for its specific strengths — classification models for the Classifier, reasoning models for Risk Analysis, creative models for Simplification.
- **Self-verification**: The Advisor uses a generate-then-critique-then-refine loop to catch hallucinations, verify numbers/dates against source text, and detect cross-clause interactions (e.g., how a termination clause affects IP survival).
- **Jurisdiction-aware analysis**: Risk and Benchmark agents are document-type-aware and adjust perspective based on Indian legal context (Rent Control Acts, Shops & Establishments Act, post-2024 non-compete trends).
- **Fault-tolerant execution**: Automatic retries with fallback models, partial failure handling, and result caching.

### Disclaimer
> LegalLens AI is an analytical tool, NOT legal advice. All outputs should be reviewed by a qualified lawyer before acting on them. The system analyzes document structure and language patterns — it does not constitute legal representation.

---

## 2. System Architecture

### 2.1 High-Level Flow

```
User uploads PDF/Image/Text
        |
        v
+---------------------+
|  INGESTION LAYER    |
|  PDF Parse -> OCR   |
|  -> Clause Segment  |
+--------+------------+
         |
         v  List of {clause_id, text, page_num, section_title}
+-------------------------------------------------+
|           AGENT ORCHESTRATOR (DAG)               |
|                                                  |
|  +----------------+    +--------------------+    |
|  | Classifier     |    | Simplifier         |    |
|  | (GPT-4o-mini)  |    | (Claude Sonnet)    |    |
|  +-------+--------+    +--------+-----------+    |
|          |                      |                |
|     (parallel)            (parallel)             |
|          |                      |                |
|          v                      |                |
|  +----------------+    +--------------------+    |
|  | Risk Analyzer  |    | Benchmark          |    |
|  | (GPT-4o)       |<---| (GPT-4o)           |    |
|  +-------+--------+    +--------+-----------+    |
|          |                      |                |
|          v                      v                |
|  +------------------------------------------+   |
|  |         Advisor Agent                     |   |
|  |         (Claude Sonnet 4.6)               |   |
|  |  (synthesizes all agent outputs)          |   |
|  +--------------------+---------------------+   |
|                       |                          |
|                       v                          |
|  +------------------------------------------+   |
|  |         Verifier Agent                    |   |
|  |         (Claude Sonnet 4.6)               |   |
|  |  (critique + refine + cross-clause check) |   |
|  +------------------------------------------+   |
+-------------------------------------------------+
         |
         v
+---------------------+
|  OUTPUT LAYER       |
|  - Risk Heatmap     |
|  - Clause Cards     |
|  - Chat (RAG)       |
|  - Negotiation PDF  |
+---------------------+
```

### 2.2 Agent Dependency Graph (DAG)

| Agent | Depends On | Runs In Parallel With | Model (Default) | Provider |
|-------|-----------|----------------------|-----------------|----------|
| Clause Classifier | Ingestion output | Simplifier | `openai/gpt-4o-mini` | OpenRouter |
| Plain Language Simplifier | Ingestion output | Classifier | `claude-sonnet-4-6-20260217` | Anthropic |
| Risk Analyzer | Classifier + Benchmark output | Benchmark (parallel, shares classifier dep) | `openai/gpt-4o` | OpenRouter |
| Benchmark Agent | Classifier output | Risk Analyzer (parallel, both need classifier) | `openai/gpt-4o` | OpenRouter |
| Advisor Agent | ALL four agents above | Nothing (sequential) | `claude-sonnet-4-6-20260217` | Anthropic |
| Verifier Agent | Advisor output | Nothing (final) | `claude-sonnet-4-6-20260217` | Anthropic |

**Execution order**: 
1. Wave 1: Classifier + Simplifier (parallel)
2. Wave 2: Risk Analyzer + Benchmark (parallel, both need Classifier)
3. Wave 3: Advisor (needs all four) -> Verifier (critiques and refines Advisor output)

This parallelism cuts total latency by ~40% compared to sequential execution. The Verifier adds ~2-3s but dramatically improves reliability.

### 2.3 Multi-Model Architecture

Each agent uses a different AI model optimized for its task:

| Agent | Default Model | Provider | Rationale |
|-------|--------------|----------|-----------|
| Segmenter | `openai/gpt-4o-mini` | OpenRouter | Fast, structural task — doesn't need heavy reasoning |
| Classifier | `openai/gpt-4o-mini` | OpenRouter | Fast, cheap — classification is a structured task |
| Simplifier | `claude-sonnet-4-6-20260217` | Anthropic direct | Best at natural, empathetic plain language (Claude 4.6 improvements) |
| Risk Analyzer | `openai/gpt-4o` | OpenRouter | Deep reasoning for edge cases and legal implications |
| Benchmark | `openai/gpt-4o` | OpenRouter | Broad legal knowledge across jurisdictions |
| Advisor | `claude-sonnet-4-6-20260217` | Anthropic direct | Best synthesizer — Claude 4.6 long-context and reasoning improvements |
| Verifier | `claude-sonnet-4-6-20260217` | Anthropic direct | Critique layer — catches hallucinations and cross-clause issues |
| RAG Chat | `claude-sonnet-4-6-20260217` | Anthropic direct | Conversational, grounded responses |

All models are configurable via environment variables without code changes:
```bash
AGENT_MODELS__CLASSIFIER__MODEL_ID=google/gemini-2.0-flash
AGENT_MODELS__RISK_ANALYZER__MODEL_ID=anthropic/claude-3-opus
AGENT_MODELS__RISK_ANALYZER__FALLBACK_MODEL_ID=openai/gpt-4o
```

### 2.4 Multi-Provider LLM Client

A unified `LLMClient` abstraction routes calls to the correct provider:

- **Anthropic Direct**: Uses `AsyncAnthropic` SDK with Messages API format
- **OpenRouter**: Uses `AsyncOpenAI` SDK pointed at `https://openrouter.ai/api/v1` (OpenAI-compatible API)

Features:
- `call()` — Single LLM call with provider routing
- `call_with_fallback()` — Tries primary model, falls back to alternate on failure
- `call_with_retry()` — Exponential backoff for transient errors (rate limits, 500s)
- Returns `LLMResponse` with: text, model used, token usage, latency_ms

---

## 3. Backend Architecture

### 3.1 Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| API Server | **FastAPI** (Python 3.11+) | Async support, auto-docs, SSE built-in |
| PDF Parsing | **PyMuPDF (fitz)** | Best Python PDF lib, extracts text with position data |
| OCR Fallback | **pytesseract** + **Pillow** | For scanned documents and image uploads |
| LLM (Anthropic) | **Anthropic SDK** (`AsyncAnthropic`) | Direct Claude API calls |
| LLM (OpenRouter) | **OpenAI SDK** (`AsyncOpenAI`) | OpenRouter uses OpenAI-compatible API |
| Embeddings | **sentence-transformers** (all-MiniLM-L6-v2) | For RAG vector search |
| Vector Store | **ChromaDB** (in-memory) | Lightweight, no infra needed |
| PDF Report Gen | **fpdf2** | Generate professional negotiation playbook PDF |
| Async Orchestration | **asyncio.gather** | Parallel agent execution |
| Configuration | **pydantic-settings** | Type-safe config with .env support |

### 3.2 Project Structure

```
legallens/
├── backend/
│   ├── main.py                    # FastAPI app, CORS, all routes, SSE streaming
│   ├── config.py                  # Pydantic BaseSettings, per-agent model configs
│   ├── models.py                  # All Pydantic request/response models
│   ├── storage.py                 # File-based document & result storage (JSON)
│   ├── llm_client.py             # Multi-provider unified LLM client
│   ├── logging_config.py         # Structured logging setup
│   ├── requirements.txt
│   │
│   ├── ingestion/
│   │   ├── __init__.py            # IngestorPipeline (composes parser + segmenter)
│   │   ├── pdf_parser.py          # PyMuPDF + smart scanned detection + OCR fallback
│   │   ├── image_parser.py        # Direct image OCR for PNG/JPG uploads
│   │   └── clause_segmenter.py    # LLM-based clause boundary detection
│   │
│   ├── agents/
│   │   ├── __init__.py
│   │   ├── orchestrator.py        # DAG runner: parallel waves, retries, caching, metrics
│   │   ├── base_agent.py          # Abstract base: run/parse/validate lifecycle + timing + hallucination guard
│   │   ├── classifier.py          # Clause Classifier Agent
│   │   ├── simplifier.py          # Plain Language Simplifier Agent
│   │   ├── risk_analyzer.py       # Risk Analyzer Agent (jurisdiction-aware)
│   │   ├── benchmark.py           # Benchmark Comparison Agent (jurisdiction-aware)
│   │   ├── advisor.py             # Advisor Agent (synthesis)
│   │   └── verifier.py            # Verifier Agent (critique + refine + cross-clause check)
│   │
│   ├── rag/
│   │   ├── __init__.py
│   │   ├── chunker.py             # Smart clause chunking with sentence overlap
│   │   ├── embeddings.py          # Sentence-transformer wrapper + ChromaDB EF
│   │   ├── retriever.py           # Hybrid search (semantic + keyword) + LLM re-ranking
│   │   └── conversation.py        # Multi-turn conversation memory
│   │
│   ├── reports/
│   │   ├── __init__.py
│   │   └── negotiation_brief.py   # Professional PDF with tables, colors, risk badges
│   │
│   └── prompts/
│       ├── __init__.py
│       └── templates.py           # All agent system prompts (centralized)
│
├── data/                          # Runtime data (auto-created)
│   ├── uploads/                   # Uploaded files
│   ├── results/                   # Cached analysis results (JSON)
│   └── metadata/                  # Document metadata (JSON)
│
├── frontend/                      # React app (vibecoded separately)
│   └── (see Section 7 for navigation/features spec)
│
├── sample_docs/                   # Pre-loaded demo documents
│   ├── rental_agreement.pdf
│   ├── employment_contract.pdf
│   ├── nda_agreement.pdf
│   └── freelance_contract.pdf
│
├── .env                           # API keys and config
├── .env.example                   # Documented env template
├── README.md
└── docker-compose.yml             # Optional containerization
```

### 3.3 API Endpoints

```python
# main.py — FastAPI routes

POST /api/upload
  - Accepts: multipart/form-data (PDF, PNG, JPG, JPEG, TXT)
  - Validates: file size (max 20MB), content type
  - Dedup: SHA-256 hash check — if same document was analyzed before, returns cached document_id
  - Returns: { document_id, filename, page_count, status: "processing" | "cached" }

POST /api/analyze/{document_id}
  - Triggers the full agent pipeline
  - Returns: SSE (Server-Sent Events) stream with real-time agent progress
    - { agent: "ingestion", status: "running" }
    - { agent: "ingestion", status: "complete", data: { clause_count: N } }
    - { agent: "classifier", status: "running" }
    - { agent: "classifier", status: "complete", data: {...}, timing_ms: 1200, model_used: "openai/gpt-4o-mini" }
    - { agent: "simplifier", status: "complete", data: {...}, timing_ms: 2100, model_used: "claude-sonnet-4-6-20260217" }
    - ... continues for each agent with timing and model info ...
    - { agent: "pipeline", status: "complete", data: { analysis_time_ms: 8500 } }

GET /api/results/{document_id}
  - Returns: Complete analysis JSON (all agent outputs merged + timing + models used)

POST /api/chat/{document_id}
  - Accepts: { message: "Can the landlord increase rent?" }
  - Uses: Hybrid RAG (semantic + keyword search) with LLM re-ranking
  - Supports: Multi-turn conversation memory
  - Returns: { answer, source_clauses: [{clause_id, text, page}] }

GET /api/report/{document_id}
  - Returns: Generated PDF negotiation brief (binary download)
  - Format: Professional PDF with color-coded risk tables, verdict badges, counter-language suggestions

POST /api/compare
  - Accepts: { document_id_1, document_id_2 }
  - Returns: Clause-by-clause diff with risk delta

GET /api/health
  - Returns: Service status, available models, storage stats
```

### 3.4 SSE Streaming for Real-Time Progress

Use Server-Sent Events so the frontend can show which agent is running, complete, etc., including which model each agent uses. This is critical for the demo — judges see different AI models activating one by one.

```python
# In main.py
from fastapi.sse import EventSourceResponse

@app.post("/api/analyze/{document_id}")
async def analyze(document_id: str):
    async def event_generator():
        async for event in orchestrator.run(document_id):
            yield {
                "event": "agent_update",
                "data": json.dumps(event)
            }
    return EventSourceResponse(event_generator())
```

---

## 4. Agent Specifications

### 4.1 Base Agent Class

```python
# agents/base_agent.py
from abc import ABC, abstractmethod
import json, re, time

class AgentParseError(Exception): pass
class AgentValidationError(Exception): pass
class AgentExecutionError(Exception): pass

class BaseAgent(ABC):
    def __init__(self, llm_client, model_config, agent_name: str):
        self.llm_client = llm_client
        self.model_config = model_config
        self.agent_name = agent_name
    
    @abstractmethod
    def system_prompt(self) -> str:
        pass
    
    @abstractmethod
    def build_user_message(self, **kwargs) -> str:
        pass
    
    @abstractmethod
    def validate_response(self, data) -> any:
        pass
    
    async def run(self, **kwargs) -> dict:
        start = time.perf_counter()
        response = await self.llm_client.call_with_retry(
            self.model_config,
            self.system_prompt(),
            self.build_user_message(**kwargs)
        )
        parsed = self.parse_response(response.text)
        validated = self.validate_response(parsed)
        # Hallucination guard: cross-check extracted data against source
        if "clauses" in kwargs:
            validated = self.hallucination_guard(validated, kwargs["clauses"])
        elapsed_ms = (time.perf_counter() - start) * 1000
        return {
            "data": validated,
            "timing_ms": round(elapsed_ms),
            "model_used": response.model
        }
    
    def parse_response(self, text: str) -> any:
        cleaned = text.strip()
        # Strip markdown code fences
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            # Regex fallback: find JSON array or object
            match = re.search(r'(\[[\s\S]*\]|\{[\s\S]*\})', cleaned)
            if match:
                return json.loads(match.group(1))
            raise AgentParseError(f"Could not parse JSON from {self.agent_name} response")
    
    def hallucination_guard(self, data: any, clauses: list) -> any:
        """Cross-check agent output against source clauses.
        
        Verifies:
        - clause_ids in output exist in source clauses
        - Numbers, dates, amounts mentioned in output appear in source text
        - Flags any fabricated clause references
        
        Override in subclasses for agent-specific checks.
        """
        clause_ids = {c["clause_id"] if isinstance(c, dict) else c.clause_id for c in clauses}
        if isinstance(data, list):
            for item in data:
                if isinstance(item, dict) and "clause_id" in item:
                    if item["clause_id"] not in clause_ids:
                        item["_hallucination_warning"] = f"clause_id {item['clause_id']} not found in source"
        return data
```

### 4.2 Clause Segmenter (Pre-Agent, Part of Ingestion)

This is NOT an agent — it's a preprocessing step that uses the LLM client to intelligently segment the document into clauses.

**Input**: Raw text extracted from PDF  
**Output**: List of clause objects

```python
# ingestion/clause_segmenter.py

SEGMENTER_PROMPT = """
You are a legal document clause segmenter. Given the raw text of a legal document, 
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

Respond with ONLY a JSON array. No explanation.
"""
```

**Long document handling**: For documents > 15000 words, split text into ~10000-word chunks at paragraph boundaries, segment each chunk separately, then merge and re-number clause_ids sequentially.

### 4.3 Agent 1: Clause Classifier

**Purpose**: Categorize each clause into a legal taxonomy.  
**Default Model**: `openai/gpt-4o-mini` via OpenRouter (fast, accurate for classification)

**Input**: List of clauses from segmenter  
**Output**: Each clause tagged with category + subcategory

```python
CLASSIFIER_SYSTEM_PROMPT = """
You are a legal clause classification specialist. You categorize legal clauses 
into a structured taxonomy.

TAXONOMY (category -> subcategories):
1. DEFINITIONS -> general_definitions, interpretation_rules
2. TERM_AND_DURATION -> commencement, duration, renewal, auto_renewal
3. PAYMENT -> rent, fees, deposit, penalties, late_payment, escalation
4. OBLIGATIONS -> tenant_obligations, landlord_obligations, employer_obligations, employee_obligations, mutual_obligations
5. TERMINATION -> termination_for_cause, termination_for_convenience, notice_period, early_termination_penalty
6. LIABILITY -> limitation_of_liability, indemnification, warranty_disclaimer, consequential_damages
7. CONFIDENTIALITY -> nda_scope, exceptions, duration_of_confidentiality, return_of_materials
8. INTELLECTUAL_PROPERTY -> ip_ownership, ip_assignment, license_grant, work_for_hire
9. DISPUTE_RESOLUTION -> governing_law, jurisdiction, arbitration, mediation
10. NON_COMPETE -> non_compete_scope, non_solicitation, geographic_restriction, time_restriction
11. FORCE_MAJEURE -> definition, obligations_during, termination_right
12. INSURANCE -> required_coverage, proof_of_insurance
13. COMPLIANCE -> regulatory, reporting, audit_rights
14. MISCELLANEOUS -> entire_agreement, amendment, waiver, severability, notices, assignment
15. REPRESENTATIONS -> representations_and_warranties, conditions_precedent
16. DATA_PRIVACY -> data_collection, data_processing, data_retention, breach_notification

For each clause, output JSON:
{
  "clause_id": <int>,
  "category": "<CATEGORY>",
  "subcategory": "<subcategory>",
  "confidence": <float 0-1>,
  "secondary_category": "<CATEGORY or null>"  // if clause spans two categories
}

Respond with ONLY a JSON array.
"""
```

### 4.4 Agent 2: Plain Language Simplifier

**Purpose**: Rewrite each clause in simple English that a non-lawyer can understand.  
**Default Model**: `claude-sonnet-4-6-20260217` via Anthropic direct (best at natural language)

```python
SIMPLIFIER_SYSTEM_PROMPT = """
You are a legal-to-plain-English translator. Your job is to rewrite legal clauses 
so that a 16-year-old with no legal background can fully understand them.

Rules:
- Use short sentences (max 20 words each)
- Replace ALL legal jargon: "indemnify" -> "pay for any losses", "notwithstanding" -> "regardless of", "hereinafter" -> drop it, "whereas" -> drop it, "force majeure" -> "events outside anyone's control (like natural disasters)"
- Use "you" and "they" instead of "the Tenant" / "the Landlord" (specify who "they" is on first use)
- Explain what the clause MEANS for the reader practically, not just what it says
- If a clause contains a hidden risk or trap, add a warning note at the end
- Keep the simplified version roughly the same length or shorter than the original
- Preserve ALL specific numbers, dates, amounts, percentages — never generalize these

For each clause, output JSON:
{
  "clause_id": <int>,
  "original_length": <word count>,
  "simplified_text": "<plain English version>",
  "simplified_length": <word count>,
  "jargon_replaced": ["list of legal terms you replaced"],
  "hidden_implications": "<what this clause really means for the reader, if not obvious>" or null
}

Respond with ONLY a JSON array.
"""
```

### 4.5 Agent 3: Risk Analyzer

**Purpose**: Score each clause on risk severity, flag specific dangerous patterns.  
**Default Model**: `openai/gpt-4o` via OpenRouter (deep reasoning capability)  
**Fallback Model**: `anthropic/claude-3.5-sonnet` via OpenRouter

**Depends on**: Classifier output (uses category to apply domain-specific risk heuristics)

```python
RISK_ANALYZER_SYSTEM_PROMPT = """
You are a legal risk analysis specialist operating in the Indian legal context.

PERSPECTIVE DETERMINATION:
First, determine the likely signer perspective based on document type:
- Rental agreement: Protect the TENANT (weaker party)
- Employment contract: Protect the EMPLOYEE (weaker party)
- Freelancer/contractor agreement: Protect the FREELANCER (weaker party)
- NDA (one-way): Protect the DISCLOSING party if mutual, or the RESTRICTED party if one-way
- NDA (mutual): Analyze from BOTH perspectives, flag imbalances
- SaaS/ToS: Protect the USER (weaker party)
- B2B contract: Analyze from the NON-DRAFTING party's perspective
Default to protecting the non-drafting party unless it's clearly mutual.

JURISDICTION AWARENESS (Indian Legal Context):
- Non-compete clauses are generally UNENFORCEABLE in India under Section 27 of the Indian Contract Act — flag any non-compete as a key issue
- Standard Indian rental agreements are 11-month leave-and-license to avoid Rent Control Act registration
- Employment notice periods in India typically 30-90 days; anything above 90 days is unusual
- Security deposit norms: 2-3 months rent for residential; return within 30-60 days of vacating
- Stamp duty and registration requirements vary by state — flag if document type requires registration but doesn't mention it
- Post-2024 Indian court trends increasingly disfavor overbroad IP assignment in employment

RISK SCORING (1-10):
- 1-3 (GREEN): Standard, fair, balanced clause
- 4-6 (YELLOW): Slightly one-sided but common; worth noting
- 7-10 (RED): Dangerous, one-sided, unusual, or potentially exploitative

RISK PATTERNS TO DETECT (flag ALL that apply):
- ONE_SIDED_INDEMNITY: Only one party indemnifies the other
- UNLIMITED_LIABILITY: No cap on liability/damages
- UNILATERAL_TERMINATION: Only one party can terminate
- SILENT_AUTO_RENEWAL: Contract auto-renews without explicit notice mechanism
- BROAD_IP_ASSIGNMENT: All IP created during employment assigned, even unrelated work
- NON_COMPETE_OVERREACH: Geographic or time scope is unreasonably broad (note: likely unenforceable in India)
- PENALTY_CLAUSE: Disproportionate penalties for breach
- WAIVER_OF_RIGHTS: Clause asks signer to waive statutory/legal rights
- VAGUE_OBLIGATIONS: Obligations described in vague terms ("reasonable", "as needed") favoring drafter
- UNILATERAL_AMENDMENT: One party can change terms without consent
- EXCESSIVE_NOTICE_PERIOD: Notice period is unusually long (>90 days for employment, >60 for rental)
- HIDDEN_FEES: Additional costs buried in clause language
- JURISDICTION_DISADVANTAGE: Dispute resolution in a location/manner disadvantageous to signer
- DATA_OVERREACH: Excessive data collection/retention rights
- SURVIVAL_CLAUSE_OVERREACH: Obligations survive termination for unreasonable duration
- UNREGISTERED_AGREEMENT: Document type legally requires registration but doesn't address it

For each clause, output JSON:
{
  "clause_id": <int>,
  "risk_score": <int 1-10>,
  "risk_level": "GREEN" | "YELLOW" | "RED",
  "perspective": "<who this risk assessment protects>",
  "flags": ["PATTERN_NAME", ...],
  "reasoning": "<2-3 sentence explanation of why this score>",
  "specific_concern": "<the exact phrase or provision that causes concern>" or null,
  "suggested_modification": "<what the signer should ask to change>" or null,
  "india_specific_note": "<any India-specific legal context relevant to this clause>" or null
}

IMPORTANT: Be genuinely analytical, not alarmist. Standard boilerplate should score 1-3.
Only flag truly concerning patterns. Always ground your reasoning in the ACTUAL clause text.

Respond with ONLY a JSON array.
"""
```

### 4.6 Agent 4: Benchmark Agent

**Purpose**: Compare each clause against "fair standard" baselines for the document type.  
**Default Model**: `openai/gpt-4o` via OpenRouter (broad legal knowledge)

**Depends on**: Classifier output (to know what type of document this is)

```python
BENCHMARK_SYSTEM_PROMPT = """
You are a legal benchmarking specialist. You compare contract clauses against 
established fair-standard baselines.

You have deep knowledge of standard terms across:
- Indian residential rental agreements (governed by state Rent Control Acts, typical 11-month lease structures)
- Indian commercial rental/lease agreements
- Indian employment contracts (governed by Indian labour law, Shops & Establishments Act)
- Freelancer/independent contractor agreements
- Non-Disclosure Agreements (mutual vs. one-way)
- Software/SaaS Terms of Service
- Standard consulting agreements

For each clause, compare against what is TYPICAL and FAIR in that document type:

DEVIATION LEVELS:
- STANDARD: This clause is normal and commonly seen
- MODERATE_DEVIATION: Slightly unusual but not necessarily unfair
- SIGNIFICANT_DEVIATION: Notably different from standard practice; worth discussing
- AGGRESSIVE: Strongly favors the drafting party; unusual in fair contracts

For each clause, output JSON:
{
  "clause_id": <int>,
  "document_type_detected": "<type of legal document>",
  "deviation_level": "STANDARD" | "MODERATE_DEVIATION" | "SIGNIFICANT_DEVIATION" | "AGGRESSIVE",
  "benchmark_comparison": "<what is standard vs. what this clause says>",
  "industry_norm": "<what a typical fair clause looks like for this provision>",
  "is_missing_standard_protection": <boolean>,
  "missing_protection_detail": "<what standard protection is absent>" or null
}

Respond with ONLY a JSON array.
"""
```

### 4.7 Agent 5: Advisor Agent

**Purpose**: Synthesize all agent outputs into a final actionable recommendation.  
**Default Model**: `claude-sonnet-4-6-20260217` via Anthropic direct (best synthesizer)

**Depends on**: ALL other agents

```python
ADVISOR_SYSTEM_PROMPT = """
You are a senior legal advisor synthesizing a complete contract analysis. 
You have received outputs from four specialist agents:
1. Clause classifications
2. Plain language simplifications
3. Risk analysis with scores and flags
4. Benchmark comparisons against fair standards

Your job is to produce a FINAL ADVISORY REPORT.

Output JSON with this structure:
{
  "document_summary": {
    "document_type": "<detected type>",
    "parties": ["Party A name/role", "Party B name/role"],
    "effective_date": "<if found>" or null,
    "duration": "<if found>" or null,
    "total_clauses_analyzed": <int>,
    "key_financial_terms": "<rent amount, salary, fees, etc.>" or null
  },
  
  "overall_risk_assessment": {
    "score": <float 1-10, weighted average>,
    "level": "LOW_RISK" | "MODERATE_RISK" | "HIGH_RISK" | "CRITICAL_RISK",
    "verdict": "SIGN" | "NEGOTIATE" | "WALK_AWAY",
    "verdict_reasoning": "<3-4 sentence explanation>"
  },
  
  "critical_issues": [
    {
      "priority": <int, 1 = most urgent>,
      "clause_id": <int>,
      "issue_title": "<short title>",
      "issue_description": "<what's wrong>",
      "impact": "<what could happen to the signer>",
      "recommended_action": "<specific ask for negotiation>",
      "suggested_counter_language": "<actual replacement clause text>"
    }
  ],
  
  "positive_aspects": [
    {
      "clause_id": <int>,
      "description": "<what's good about this clause>"
    }
  ],
  
  "missing_clauses": [
    {
      "clause_type": "<what's missing>",
      "why_important": "<why the signer should ask for this>",
      "suggested_language": "<proposed clause text>"
    }
  ],
  
  "negotiation_priority_order": [
    "<Issue 1 — must negotiate>",
    "<Issue 2 — should negotiate>",
    "<Issue 3 — nice to have>"
  ],
  
  "executive_summary": "<A 4-5 sentence summary a non-lawyer can read to understand the full picture>"
}

Be balanced. Not every contract is dangerous. If it's fair, say so.
Only recommend WALK_AWAY for genuinely exploitative contracts.
"""
```

### 4.8 Agent 6: Verifier Agent (Critique & Refine Layer)

**Purpose**: Critique the Advisor's output, catch hallucinations, verify cross-clause interactions, and refine the final report.  
**Default Model**: `claude-sonnet-4-6-20260217` via Anthropic direct (same model for consistency)

**Depends on**: Advisor output + original clauses

This implements a generate-then-critique-then-refine pattern (aligned with L-MARS-style verification workflows). The Verifier is NOT a separate wave — it runs sequentially after Advisor in Wave 3.

```python
VERIFIER_SYSTEM_PROMPT = """
You are a legal analysis verifier. You have received a draft advisory report from 
a senior legal advisor. Your job is to CRITIQUE and REFINE it.

VERIFICATION CHECKLIST:
1. FACTUAL ACCURACY: Cross-check all numbers, dates, amounts, and percentages in the 
   report against the original clause text provided. Flag any that don't match.

2. CROSS-CLAUSE INTERACTIONS: Check for interactions between clauses that the advisor 
   may have missed:
   - Does the termination clause affect IP/confidentiality survival clauses?
   - Does the force majeure clause provide an escape from payment obligations?
   - Do non-compete + IP assignment clauses create compound restrictions?
   - Does the dispute resolution clause affect the enforceability of penalty clauses?

3. HALLUCINATION CHECK: Verify that:
   - Every clause_id referenced in critical_issues actually exists
   - Suggested counter-language is legally sound and not fabricated
   - The verdict (SIGN/NEGOTIATE/WALK_AWAY) is proportionate to the actual issues found

4. COMPLETENESS: Check if the advisor missed:
   - Any RED-flagged clauses from the risk analysis
   - Any AGGRESSIVE deviations from the benchmark analysis
   - Standard protections that should be mentioned as missing

5. INDIA-SPECIFIC VERIFICATION:
   - Non-compete enforceability under Section 27 of Indian Contract Act
   - Stamp duty and registration requirements
   - State-specific Rent Control Act implications
   - Employment law compliance (Shops & Establishments Act)

Output the REFINED advisory report in the same JSON structure as the Advisor output,
with these additions:
{
  ... (same structure as Advisor output) ...,
  "verification_notes": {
    "factual_corrections": ["<any corrections made>"],
    "cross_clause_interactions": ["<interactions detected>"],
    "hallucinations_caught": ["<any fabrications removed>"],
    "completeness_additions": ["<issues or protections added>"],
    "confidence_score": <float 0-1, overall confidence in the report>
  }
}

If the Advisor's report is accurate and complete, return it unchanged with 
verification_notes showing what you checked and confidence_score near 1.0.

Respond with ONLY a JSON object.
"""
```

### 4.9 Orchestrator Implementation

```python
# agents/orchestrator.py
import asyncio
from typing import AsyncGenerator

class AgentOrchestrator:
    def __init__(self, llm_client, settings, storage):
        self.classifier = ClassifierAgent(llm_client, settings.agent_models.classifier, "classifier")
        self.simplifier = SimplifierAgent(llm_client, settings.agent_models.simplifier, "simplifier")
        self.risk_analyzer = RiskAnalyzerAgent(llm_client, settings.agent_models.risk_analyzer, "risk_analyzer")
        self.benchmark = BenchmarkAgent(llm_client, settings.agent_models.benchmark, "benchmark")
        self.advisor = AdvisorAgent(llm_client, settings.agent_models.advisor, "advisor")
        self.verifier = VerifierAgent(llm_client, settings.agent_models.verifier, "verifier")
        self.storage = storage
    
    async def run(self, document_id: str, clauses: list) -> AsyncGenerator[dict, None]:
        # Cache check
        cached = self.storage.get_result(document_id)
        if cached:
            yield {"agent": "pipeline", "status": "cached", "data": cached}
            return
        
        # Wave 1: Classifier + Simplifier (parallel)
        yield {"agent": "classifier", "status": "running"}
        yield {"agent": "simplifier", "status": "running"}
        
        classifier_result, simplifier_result = await asyncio.gather(
            self._run_agent(self.classifier, clauses=clauses),
            self._run_agent(self.simplifier, clauses=clauses),
            return_exceptions=True
        )
        
        # Handle results (partial failure OK for simplifier)
        classifier_ok = not isinstance(classifier_result, Exception)
        simplifier_ok = not isinstance(simplifier_result, Exception)
        
        yield self._make_event("classifier", classifier_result)
        yield self._make_event("simplifier", simplifier_result)
        
        if not classifier_ok:
            # Can't proceed without classifier
            yield {"agent": "pipeline", "status": "error", "error": "Classifier failed"}
            return
        
        # Wave 2: Risk Analyzer + Benchmark (parallel, need classifier)
        yield {"agent": "risk_analyzer", "status": "running"}
        yield {"agent": "benchmark", "status": "running"}
        
        risk_result, benchmark_result = await asyncio.gather(
            self._run_agent(self.risk_analyzer, clauses=clauses, classifications=classifier_result["data"]),
            self._run_agent(self.benchmark, clauses=clauses, classifications=classifier_result["data"]),
            return_exceptions=True
        )
        
        yield self._make_event("risk_analyzer", risk_result)
        yield self._make_event("benchmark", benchmark_result)
        
        # Wave 3: Advisor (needs everything — uses whatever succeeded)
        yield {"agent": "advisor", "status": "running"}
        
        advisor_result = await self._run_agent(
            self.advisor,
            clauses=clauses,
            classifications=classifier_result["data"] if classifier_ok else None,
            simplifications=simplifier_result["data"] if simplifier_ok else None,
            risks=risk_result["data"] if not isinstance(risk_result, Exception) else None,
            benchmarks=benchmark_result["data"] if not isinstance(benchmark_result, Exception) else None
        )
        
        yield self._make_event("advisor", advisor_result)
        
        # Wave 3b: Verifier (critiques and refines Advisor output)
        if not isinstance(advisor_result, Exception):
            yield {"agent": "verifier", "status": "running"}
            
            verifier_result = await self._run_agent(
                self.verifier,
                clauses=clauses,
                advisor_output=advisor_result["data"],
                risks=risk_result["data"] if not isinstance(risk_result, Exception) else None,
                benchmarks=benchmark_result["data"] if not isinstance(benchmark_result, Exception) else None
            )
            
            yield self._make_event("verifier", verifier_result)
            
            # Use verified result as final output (falls back to advisor if verifier fails)
            final_advisory = verifier_result["data"] if not isinstance(verifier_result, Exception) else advisor_result["data"]
        else:
            final_advisory = None
        
        # Save results and emit final event
        # ... assemble AnalysisResult with final_advisory, save to storage ...
        yield {"agent": "pipeline", "status": "complete", "data": {"analysis_time_ms": total_ms}}
```

---

## 5. RAG System for Document Chat

### 5.1 Architecture

```
User Question + Conversation History
      |
      v
[Embed Question] --> Query Vector
      |
      v
[Hybrid Search: Semantic + Keyword] --> Top 10 candidates
      |
      v
[LLM Re-Ranking] --> Top 5 most relevant
      |
      v
[Claude with Context + History] --> Grounded Answer + Clause References
```

### 5.2 Implementation

```python
# rag/chunker.py
def chunk_clauses(clauses: list, max_chunk_size: int = 500, overlap_sentences: int = 1) -> list:
    """
    Each clause becomes a chunk. If a clause is too long, 
    split on sentence boundaries while preserving clause_id metadata.
    Adds sentence overlap between chunks for context continuity.
    """
    chunks = []
    for clause in clauses:
        text = clause["text"]
        if len(text.split()) <= max_chunk_size:
            chunks.append({
                "chunk_id": f"clause_{clause['clause_id']}",
                "text": text,
                "clause_id": clause["clause_id"],
                "title": clause.get("title", ""),
                "page": clause.get("page_number", 0)
            })
        else:
            sentences = text.split(". ")
            current_chunk = []
            for sent in sentences:
                current_chunk.append(sent)
                if len(" ".join(current_chunk).split()) >= max_chunk_size:
                    chunks.append({
                        "chunk_id": f"clause_{clause['clause_id']}_part_{len(chunks)}",
                        "text": ". ".join(current_chunk) + ".",
                        "clause_id": clause["clause_id"],
                        "title": clause.get("title", ""),
                        "page": clause.get("page_number", 0)
                    })
                    # Keep last N sentences for overlap
                    current_chunk = current_chunk[-overlap_sentences:]
            if current_chunk:
                chunks.append({
                    "chunk_id": f"clause_{clause['clause_id']}_part_{len(chunks)}",
                    "text": ". ".join(current_chunk) + ".",
                    "clause_id": clause["clause_id"],
                    "title": clause.get("title", ""),
                    "page": clause.get("page_number", 0)
                })
    return chunks

# rag/retriever.py — Enhanced with hybrid search + re-ranking
RAG_SYSTEM_PROMPT = """
You are a legal document Q&A assistant. Answer the user's question based ONLY 
on the provided document clauses. 

Rules:
- Always cite which clause(s) your answer comes from: "According to Clause 5 (Termination)..."
- If the answer isn't in the document, say "This document doesn't address that topic."
- Use simple language, not legalese
- If the question is about rights, also mention any relevant obligations
- If there's ambiguity in the clause, flag it: "This clause is ambiguous and could be interpreted as..."
"""
```

### 5.3 Conversation Memory

Multi-turn chat support — the system remembers prior questions in the same session:

```python
# rag/conversation.py
class ConversationMemory:
    """In-memory per-document conversation history"""
    
    def add_message(self, document_id: str, role: str, content: str): ...
    def get_history(self, document_id: str, max_turns: int = 10) -> list[dict]: ...
    def clear(self, document_id: str): ...
```

---

## 6. Data Sources & Sample Documents

### 6.1 Where to Get Example Legal Documents

| Source | URL | What's Available | License |
|--------|-----|-----------------|---------|
| **Indian Kanoon** | https://indiankanoon.org | Court judgments, legal texts | Public domain |
| **LawRato Templates** | https://lawrato.com/legal-documents | Indian rental, employment, NDA templates | Free templates available |
| **LegalDesk** | https://legaldesk.com | Indian rental agreement templates | Free previews |
| **Rocket Lawyer (India)** | https://www.rocketlawyer.com/in | Various contract templates | Free with signup |
| **ContractStore** | https://www.contractstore.com | Sample contracts (international) | Some free samples |
| **SEC EDGAR** | https://www.sec.gov/cgi-bin/browse-edgar | Real corporate contracts in 10-K filings | Public domain |
| **SAFT/SAFE templates** | YCombinator website | Startup investment agreements | Open source |
| **GitHub "awesome-legal"** | https://github.com/topics/legal-documents | Community-contributed templates | Various open licenses |

### 6.2 Recommended Demo Documents

For the hackathon demo, prepare these specific documents:

1. **Indian 11-month residential rental agreement** — Most relatable. Find a real template from LegalDesk or draft one with common problematic clauses (unilateral rent increase, no-pet clause, broad damage liability, lock-in period).

2. **Indian employment contract** — Include non-compete, IP assignment, notice period, and variable pay clauses. Source from HR template sites or create a realistic one.

3. **Freelancer/Contractor NDA** — One-sided NDA that only restricts the freelancer. Good for showing benchmark deviations.

4. **SaaS Terms of Service** — Copy from a real (small) SaaS company's public ToS page. Shows data privacy analysis capability.

### 6.3 Creating Synthetic Demo Documents

If you can't find a good real document, create synthetic ones with deliberately planted issues:

```python
DEMO_CLAUSES = {
    "good_clause": "The monthly rent shall be Rs. 25,000, payable on or before the 5th of each month.",
    
    "yellow_clause": "The Lessor may increase the rent by up to 10% annually upon providing 30 days written notice.",
    
    "red_clause_1": "The Lessee shall indemnify and hold harmless the Lessor against ALL claims, damages, losses, costs, and expenses of whatever nature arising from the Lessee's use of the premises, INCLUDING those arising from the Lessor's own negligence.",
    
    "red_clause_2": "The Lessor reserves the right to enter the premises at any time without prior notice for inspection, repairs, or any other purpose deemed necessary by the Lessor.",
    
    "red_clause_3": "Upon termination, any improvements or fixtures installed by the Lessee shall become the property of the Lessor without compensation.",
    
    "missing_standard": "No clause about security deposit return timeline (standard is 30-60 days)"
}
```

### 6.4 APIs and External Services

| Service | Purpose | Access |
|---------|---------|--------|
| **Anthropic Claude API** | Direct Claude 4.6 calls (Simplifier, Advisor, Verifier, RAG) | API key from console.anthropic.com |
| **OpenRouter API** | Access to GPT-4o, GPT-4o-mini, Gemini, Llama, etc. | API key from openrouter.ai |
| **Tesseract OCR** | Scanned document fallback | `brew install tesseract` (macOS) / `apt-get install tesseract-ocr` (Linux) |
| **sentence-transformers** | Embedding generation for RAG | `pip install sentence-transformers` (free, runs locally) |
| **ChromaDB** | Vector storage for RAG | `pip install chromadb` (free, in-memory) |

---

## 7. Frontend Specification (Navigation & Features)

> Note: Frontend will be vibecoded. This section defines WHAT to build, not HOW.

### 7.1 Application Navigation

```
+------------------------------------------+
|  LegalLens AI        [Upload] [History]  |  <- Top nav
+------------------------------------------+
|                                          |
|  Landing / Upload Page                   |  <- Default view
|  ---------------------                   |
|  - Drag & drop zone for PDF              |
|  - "Try a sample" buttons (pre-loaded    |
|    demo docs)                            |
|  - Supported formats: PDF, PNG, JPG, TXT |
|                                          |
+------------------------------------------+
|                                          |
|  Processing Page (after upload)          |
|  ---------------------                   |
|  - Agent pipeline visualization          |
|  - Each agent shows model name + status  |
|  - Progress bar or step indicator        |
|  - Per-agent timing display              |
|                                          |
+------------------------------------------+
|                                          |
|  Results Dashboard (main view)           |
|  ---------------------                   |
|  - Three-tab or split layout:            |
|    [Overview] [Clauses] [Chat]           |
|                                          |
|  OVERVIEW TAB:                           |
|  - Verdict badge: SIGN/NEGOTIATE/WALK    |
|  - Overall risk score (circular gauge)   |
|  - Risk distribution (pie/donut chart)   |
|  - Executive summary text                |
|  - Critical issues list (priority order) |
|  - Missing clauses warnings              |
|  - "Export PDF" dropdown button:          |
|    -> Negotiation Brief                  |
|    -> Risk Summary Report                |
|    -> Clause-by-Clause Report            |
|    -> Full Analysis Bundle               |
|  - Models used summary                   |
|                                          |
|  CLAUSES TAB:                            |
|  - Scrollable list of all clauses        |
|  - Each clause = expandable card:        |
|    +------------------------------+      |
|    | RED Clause 7: Indemnification |      |
|    | Category: LIABILITY           |      |
|    | Risk Score: 8/10              |      |
|    +------------------------------+      |
|    | [Original] [Simplified] tabs  |      |
|    | ----------------------------- |      |
|    | Risk Flags: ONE_SIDED_INDEM   |      |
|    | Benchmark: AGGRESSIVE         |      |
|    | Suggested Fix: "Add mutual    |      |
|    | indemnification..."           |      |
|    +------------------------------+      |
|  - Filter by risk level (R/Y/G)         |
|  - Filter by category                    |
|  - Sort by risk score                    |
|                                          |
|  CHAT TAB:                               |
|  - Chat interface for document Q&A       |
|  - Multi-turn conversation support       |
|  - Shows source clause references        |
|  - Suggested questions as chips:         |
|    "What are my obligations?"            |
|    "Can they terminate without notice?"  |
|    "What happens if I break this?"       |
|                                          |
+------------------------------------------+
|                                          |
|  Compare Page (optional, stretch goal)   |
|  ---------------------                   |
|  - Side-by-side document comparison      |
|  - Diff highlighting                     |
|  - Risk delta: "New version added 2 red  |
|    clauses, resolved 1"                  |
|                                          |
+------------------------------------------+
```

### 7.2 Key UI Components

1. **Risk Heatmap** — A visual representation of the document where each clause is a block colored by risk level. Can be a vertical bar, a grid, or a document-shaped visualization.

2. **Agent Pipeline Visualizer** — During processing, show the 5 agents as nodes in a flow diagram with their model names. Animate connections as data flows between them. Show per-agent timing. This is the "wow" moment during demo.

3. **Clause Cards** — Expandable cards with tabs for Original/Simplified text, risk flags as colored badges, benchmark deviation as a label, and suggested modifications in a highlighted box.

4. **Verdict Badge** — Large, prominent display of SIGN (green) / NEGOTIATE (yellow) / WALK AWAY (red) with the overall score.

5. **Chat Panel** — Standard chat UI with message bubbles. Bot responses include clause reference chips that scroll to the relevant clause when clicked. Multi-turn conversation support.

---

## 8. Negotiation Brief PDF Report

Auto-generated downloadable PDF with professional formatting:

```
LEGALLENS AI — NEGOTIATION BRIEF
==================================

Document: [filename]
Analyzed: [date]
Overall Verdict: [SIGN/NEGOTIATE/WALK AWAY] (color-coded badge)
Risk Score: [X/10]
Models Used: [list of models that analyzed this document]

EXECUTIVE SUMMARY
[4-5 sentence summary from Advisor agent]

CRITICAL ISSUES (Priority Order)
+------+-------------------+------+----------------------------------+
| Rank | Clause            | Risk | Issue                            |
+------+-------------------+------+----------------------------------+
| 1    | #7 Indemnification| 8/10 | One-sided indemnity clause       |
+------+-------------------+------+----------------------------------+

For each critical issue:
   Impact: [What could happen]
   Ask For: [Specific negotiation point]
   Suggested Language: "[replacement text]" (shaded box)

MISSING PROTECTIONS
- [What's missing + why it matters]

POSITIVE ASPECTS
- [What's fair in this contract]

CLAUSE-BY-CLAUSE ANALYSIS
[Color-coded table: Clause | Category | Risk (green/yellow/red) | Deviation | Summary]

NEGOTIATION CHECKLIST
[ ] Issue 1 — must negotiate
[ ] Issue 2 — should negotiate  
[ ] Issue 3 — nice to have
```

### 8.1 PDF Export System

Inspired by commercial platforms like AI Lawyer Pro that offer downloadable documents as a core feature, LegalLens AI provides a comprehensive PDF export system — not just the negotiation brief, but exportable views across the entire analysis.

**Exportable PDF Documents:**

| Export Type | Contents | When to Use |
|-------------|----------|-------------|
| **Negotiation Brief** | Full brief as described above (verdict, critical issues, suggested language, checklist) | Share with lawyer or counterparty before negotiation |
| **Risk Summary Report** | Executive summary, risk score, risk distribution chart, critical issues list, missing protections | Quick overview for decision-makers or stakeholders |
| **Clause-by-Clause Report** | Complete table of all clauses with category, risk level, benchmark deviation, and plain-English explanation | Detailed internal review or legal team handoff |
| **Full Analysis Bundle** | Combined PDF with all sections — summary, heatmap snapshot, clause details, chat highlights, and negotiation checklist | Comprehensive record-keeping or compliance documentation |

**PDF Export UX:**
- **"Export PDF" dropdown button** on the results page header with options for each export type
- Loading state with progress indicator ("Generating PDF...")
- Generated PDFs include LegalLens AI branding, document metadata (filename, analysis date, models used), and page numbers
- All risk levels are color-coded in the PDF (green/yellow/red) for quick visual scanning
- PDFs are generated client-side using **fpdf2** on the backend, served via the `/api/export/{type}` endpoint

**API Endpoint:**
```
GET /api/export/{export_type}
  - Path param: export_type = "negotiation_brief" | "risk_summary" | "clause_report" | "full_bundle"
  - Query param: analysis_id (required)
  - Returns: application/pdf binary stream
  - Headers: Content-Disposition: attachment; filename="legallens_{export_type}_{date}.pdf"
```

---

## 9. Installation & Setup

### 9.1 Backend Setup

```bash
# Clone and setup
cd legallens/backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Set API keys
cp .env.example .env
# Edit .env with your keys

# Install Tesseract OCR
brew install tesseract          # macOS
# OR: sudo apt-get install tesseract-ocr  # Ubuntu

# Run server
uvicorn main:app --reload --port 8000
```

### 9.2 requirements.txt

```
fastapi>=0.115.0
uvicorn[standard]>=0.24.0
python-multipart>=0.0.6
anthropic>=0.40.0
openai>=1.50.0
PyMuPDF>=1.23.0
pytesseract>=0.3.10
Pillow>=10.0.0
chromadb>=0.4.0
sentence-transformers>=2.2.0
fpdf2>=2.7.0
pydantic>=2.5.0
pydantic-settings>=2.1.0
python-dotenv>=1.0.0
sse-starlette>=1.8.0
```

### 9.3 .env.example

```bash
# === Required API Keys ===
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...

# === Server Config ===
LOG_LEVEL=INFO
MAX_FILE_SIZE_MB=20
CORS_ORIGINS=["http://localhost:3000","http://localhost:5173"]

# === Override Agent Models (optional) ===
# AGENT_MODELS__SEGMENTER__MODEL_ID=openai/gpt-4o-mini
# AGENT_MODELS__SEGMENTER__PROVIDER=openrouter
# AGENT_MODELS__CLASSIFIER__MODEL_ID=openai/gpt-4o-mini
# AGENT_MODELS__CLASSIFIER__PROVIDER=openrouter
# AGENT_MODELS__SIMPLIFIER__MODEL_ID=claude-sonnet-4-6-20260217
# AGENT_MODELS__SIMPLIFIER__PROVIDER=anthropic
# AGENT_MODELS__RISK_ANALYZER__MODEL_ID=openai/gpt-4o
# AGENT_MODELS__RISK_ANALYZER__PROVIDER=openrouter
# AGENT_MODELS__RISK_ANALYZER__FALLBACK_MODEL_ID=anthropic/claude-3.5-sonnet
# AGENT_MODELS__BENCHMARK__MODEL_ID=openai/gpt-4o
# AGENT_MODELS__BENCHMARK__PROVIDER=openrouter
# AGENT_MODELS__ADVISOR__MODEL_ID=claude-sonnet-4-6-20260217
# AGENT_MODELS__ADVISOR__PROVIDER=anthropic
# AGENT_MODELS__VERIFIER__MODEL_ID=claude-sonnet-4-6-20260217
# AGENT_MODELS__VERIFIER__PROVIDER=anthropic
# AGENT_MODELS__RAG_CHAT__MODEL_ID=claude-sonnet-4-6-20260217
# AGENT_MODELS__RAG_CHAT__PROVIDER=anthropic
```

---

## 10. Hackathon Demo Script (2 Minutes)

### Setup Before Demo
- Have the server running
- Have a sample Indian rental agreement PDF ready (with known red clauses)
- Have the frontend loaded on the upload page
- Pre-cache one analysis result as fallback in case of API timeout

### The Script

**[0:00 - 0:15] Hook**
"Every year, millions of Indians sign rental agreements they don't fully understand. LegalLens AI reads them so you don't have to."

**[0:15 - 0:30] Upload**
Drag and drop a rental agreement PDF. Show the agent pipeline activating — "See how each agent uses a different AI model? GPT-4o-mini classifies, Claude simplifies, GPT-4o analyzes risk..."

**[0:30 - 1:00] The Reveal**
Results dashboard appears. Point to:
- The verdict badge: "NEGOTIATE — 3 critical issues found"
- The risk heatmap: "See these red blocks? Those are the clauses that could hurt you."
- Click one red clause: show original legalese vs. plain English side by side
- "This analysis took 8 seconds across 5 AI agents running in parallel"

**[1:00 - 1:20] Risk Deep Dive**
Click the worst clause (e.g., one-sided indemnification):
- "This clause means if anyone gets hurt on the property — even if it's the landlord's fault — YOU pay. Our system caught this and suggests mutual indemnification instead."
- Show the suggested replacement language.

**[1:20 - 1:40] Chat**
Switch to chat tab. Ask: "Can the landlord enter my apartment without notice?"
Show the grounded answer with clause reference. Ask a follow-up to demo multi-turn memory.

**[1:40 - 2:00] Close**
"LegalLens AI doesn't just summarize — it thinks. Five agents, three AI providers, all collaborating to classify, simplify, assess risk, benchmark against fair standards, and advise. Download the negotiation brief and walk into your next signing prepared."

Click "Download Negotiation Brief" — show the professional PDF.

---

## 11. Stretch Goals (If Time Permits)

Listed in priority order — do these only after the core pipeline works:

1. **Multi-language support** — Accept documents in Hindi/Kannada, translate to English for analysis, present results in original language
2. **Document comparison** — Upload two versions, show diff with risk delta
3. **Clause amendment mode** — User edits a clause, system re-analyzes just that clause in real-time
4. **Voice Q&A** — Ask questions about the document via voice (Web Speech API)
5. **Export to WhatsApp/Email** — Share the risk summary as a formatted message
6. **Browser extension** — Analyze Terms of Service on any webpage

---

## 12. Error Handling & Edge Cases

- **Empty PDF / Image-only PDF**: Detect low text extraction (< 50 words) -> trigger OCR pipeline -> if OCR also fails, show clear error: "This document couldn't be read. Please upload a clearer scan."
- **Non-legal document**: The Classifier agent should detect this and return a flag. Show: "This doesn't appear to be a legal document. Results may not be accurate."
- **Very long documents (50+ pages)**: Chunk into sections, process in batches of 15-20 clauses per agent call to stay within context limits.
- **API rate limits**: Implement retry with exponential backoff. Cache results by document hash.
- **Partial agent failure**: If one agent fails, still show results from the others. Mark the failed agent's section as "Analysis unavailable — retry?"
- **Model fallback**: If primary model fails, automatically try fallback model (e.g., if GPT-4o fails, fall back to Claude Sonnet via OpenRouter).
- **Duplicate uploads**: SHA-256 hash dedup — same document returns cached results instantly.
- **JSON parse errors**: Regex fallback to extract JSON from LLM responses that include extra text.

---

## 13. What Judges Will Look For vs. What We Deliver

| Judging Criteria | Our Answer |
|-----------------|-----------|
| "Is it agentic?" | 5 specialized agents with a real dependency DAG, parallel execution, autonomous decision-making |
| "Is it technically complex?" | Multi-model architecture across 3 providers, fallback chains, hybrid RAG with re-ranking, async parallel execution |
| "Does it work?" | Live demo with real document, real analysis, real results in < 10 seconds |
| "Is it useful?" | Everyone has signed a contract they didn't understand |
| "Is it technically impressive?" | Multi-agent orchestration, SSE streaming, RAG, per-agent timing, model-per-agent configurability |
| "Is the UI good?" | Risk heatmap, agent pipeline animation with model names, clause cards with side-by-side comparison |
| "Can it scale?" | Stateless API, document-level caching, modular agent architecture, configurable models |

---

## 14. Configuration & Observability

### 14.1 Pydantic Settings Configuration

All configuration is managed through `pydantic-settings` with `.env` support:

```python
# config.py
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import BaseModel

class ModelConfig(BaseModel):
    provider: Literal["anthropic", "openrouter"] = "openrouter"
    model_id: str
    max_tokens: int = 4096
    temperature: float = 0.1
    fallback_model_id: str | None = None

class AgentModelsConfig(BaseModel):
    segmenter: ModelConfig = ModelConfig(provider="openrouter", model_id="openai/gpt-4o-mini")
    classifier: ModelConfig = ModelConfig(provider="openrouter", model_id="openai/gpt-4o-mini")
    simplifier: ModelConfig = ModelConfig(provider="anthropic", model_id="claude-sonnet-4-6-20260217")
    risk_analyzer: ModelConfig = ModelConfig(provider="openrouter", model_id="openai/gpt-4o", fallback_model_id="anthropic/claude-3.5-sonnet")
    benchmark: ModelConfig = ModelConfig(provider="openrouter", model_id="openai/gpt-4o")
    advisor: ModelConfig = ModelConfig(provider="anthropic", model_id="claude-sonnet-4-6-20260217")
    verifier: ModelConfig = ModelConfig(provider="anthropic", model_id="claude-sonnet-4-6-20260217")
    rag_chat: ModelConfig = ModelConfig(provider="anthropic", model_id="claude-sonnet-4-6-20260217")

class Settings(BaseSettings):
    anthropic_api_key: str
    openrouter_api_key: str
    agent_models: AgentModelsConfig = AgentModelsConfig()
    upload_dir: str = "data/uploads"
    results_dir: str = "data/results"
    metadata_dir: str = "data/metadata"
    max_retries: int = 3
    retry_base_delay: float = 1.0
    max_file_size_mb: int = 20
    log_level: str = "INFO"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]
    
    model_config = SettingsConfigDict(env_file='.env', env_nested_delimiter='__')
```

### 14.2 Structured Logging

Every agent call is logged with:
- Agent name
- Model used (primary vs fallback)
- Input token count
- Output token count
- Latency in milliseconds
- Success/failure status
- Retry attempts

### 14.3 Analysis Result Metadata

Every analysis result includes:
```json
{
  "agent_timings": {
    "classifier": 850,
    "simplifier": 2100,
    "risk_analyzer": 3200,
    "benchmark": 2800,
    "advisor": 4100,
    "verifier": 2500
  },
  "models_used": {
    "classifier": "openai/gpt-4o-mini",
    "simplifier": "claude-sonnet-4-6-20260217",
    "risk_analyzer": "openai/gpt-4o",
    "benchmark": "openai/gpt-4o",
    "advisor": "claude-sonnet-4-6-20260217",
    "verifier": "claude-sonnet-4-6-20260217"
  },
  "total_analysis_time_ms": 11000,
  "cache_hit": false,
  "verification_confidence": 0.92
}
```
