# Models & API Cost Reference

All Suits AI agents call LLMs through OpenRouter, so swapping a model is a
one-line change in `suits/backend/config.py` (or, in production, a single
env var like `AGENT_MODELS__SIMPLIFIER__MODEL_ID=...`).

This document captures the **current defaults**, the **rationale per
agent**, and a **cost estimate per document analysis** so the model choices
stay deliberate as we iterate.

## TL;DR

- Default provider: **xAI Grok via OpenRouter** (`x-ai/grok-4-fast` for the
  bulk extraction work, `x-ai/grok-4` for synthesis).
- Every agent has a Claude Sonnet 4.5 fallback so the pipeline keeps
  working if Grok is rate-limited or down.
- Estimated cost per full document analysis (≈30 clauses, 7 agents):
  **~$0.04 – $0.10** depending on length.

## Per-agent assignments

| Agent | Default model | Why |
| --- | --- | --- |
| `segmenter` | `x-ai/grok-4-fast` | Mechanical splitting of raw text into clauses — cheap and high volume. |
| `classifier` | `x-ai/grok-4-fast` | Per-clause label + confidence; runs once per clause. |
| `simplifier` | `x-ai/grok-4-fast` | Rewrite clause in plain English; structured output, high volume. |
| `benchmark` | `x-ai/grok-4-fast` | Compare each clause against a stored norm; per-clause. |
| `risk_analyzer` | `x-ai/grok-4` | One synthesis pass per clause; mistakes here cascade into the advisory. |
| `advisor` | `x-ai/grok-4` | Single-shot synthesis of the whole doc — needs better reasoning. |
| `verifier` | `x-ai/grok-4` | Cross-clause hallucination check; final guard. |
| `rag_chat` | `x-ai/grok-4-fast` | Latency-sensitive; usually short answers. |
| `general_chat` | `x-ai/grok-4-fast` | Same. Falls back to `openai/gpt-4o-mini`. |
| `negotiator_agent1` | `x-ai/grok-4-fast` | Multi-round, intentionally cheap. |
| `negotiator_agent2` | `openai/gpt-4o-mini` | Different model on purpose so the two sides don't sound identical. |
| `scenario_simulator` | `x-ai/grok-4` | Generates structured outcomes + financial estimates; quality matters. |

## OpenRouter pricing (snapshot)

Prices are USD per **1M tokens**. OpenRouter passes provider pricing
through with a small fee; check `https://openrouter.ai/models` for the
authoritative number before any pricing announcement.

| Model | Input | Output | Notes |
| --- | --- | --- | --- |
| `x-ai/grok-4-fast` | ~$0.20 | ~$0.50 | The fast/cheap tier we lean on by default. |
| `x-ai/grok-4` | ~$3.00 | ~$15.00 | Reserved for synthesis agents. |
| `anthropic/claude-sonnet-4-5` | $3.00 | $15.00 | Fallback. |
| `openai/gpt-4o-mini` | $0.15 | $0.60 | Cheapest GPT — used as secondary fallback. |
| `google/gemini-2.0-flash-001` | $0.075 | $0.30 | Used in negotiator fallback. |

## Cost per document analysis

Assumptions for the worked example:
- 30 clauses, ~120 tokens of input per clause, ~150 tokens of structured
  output per clause for per-clause agents.
- Advisor / verifier / risk_analyzer see the entire compressed doc (~10k
  input tokens) and emit ~2k output tokens each.

| Agent | Calls | In tokens | Out tokens | Cost @ default model |
| --- | --- | --- | --- | --- |
| segmenter | 1 | 8,000 | 3,000 | ~$0.0032 |
| classifier | 30 | 3,600 | 4,500 | ~$0.0030 |
| simplifier | 30 | 3,600 | 6,000 | ~$0.0038 |
| benchmark | 30 | 3,600 | 4,500 | ~$0.0030 |
| risk_analyzer | 1 | 10,000 | 2,000 | ~$0.0600 |
| advisor | 1 | 10,000 | 2,000 | ~$0.0600 |
| verifier | 1 | 10,000 | 1,500 | ~$0.0525 |
| **Total** |  |  |  | **≈ $0.17 worst-case** |

In practice, shorter docs and prompt caching bring this closer to
**$0.04 – $0.10 per document**. If we move `risk_analyzer` /
`advisor` / `verifier` to `grok-4-fast` the worst-case drops to ~$0.03
total, at the cost of some reasoning quality.

## Chat costs

A single chat exchange (~1.5k context, ~400-token answer) on
`grok-4-fast` costs roughly **$0.00050 / message**. With the Sonnet
fallback it's ~$0.011 / message — 20× more, but still cheap.

## How to override

Per-agent env override (e.g. on Render):
```
AGENT_MODELS__RISK_ANALYZER__MODEL_ID=anthropic/claude-sonnet-4-5
AGENT_MODELS__RISK_ANALYZER__MAX_TOKENS=4096
```

Or edit `suits/backend/config.py` directly — the per-agent defaults live in
`AgentModelsConfig`.

## When to deviate from defaults

- **Demo day or high-stakes analyses** — flip the synthesis agents
  (risk_analyzer, advisor, verifier) to `anthropic/claude-sonnet-4-5`.
  Cost goes up ~3× but the verification quality is meaningfully higher.
- **Cost-sensitive batch runs** — move everything to `x-ai/grok-4-fast`
  and accept some loss in the cross-clause interaction checks.
- **Latency-sensitive chat** — `openai/gpt-4o-mini` is currently the
  fastest first-token option among the available providers; switch
  `rag_chat`/`general_chat` if streaming feels sluggish.
