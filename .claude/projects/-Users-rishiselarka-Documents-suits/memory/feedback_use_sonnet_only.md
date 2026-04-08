---
name: Use Sonnet only for all app LLM calls
description: All agents and chat in the Suits app must use anthropic/claude-sonnet-4-5 via OpenRouter — no GPT-4o, no Opus
type: feedback
---

All LLM calls in the app must use `anthropic/claude-sonnet-4-5` via OpenRouter. No GPT-4o, no GPT-4o-mini, no Opus.

**Why:** User explicitly wants Sonnet only for all tasks — document analysis, chat, everything.

**How to apply:** When touching config.py or agent model configs, ensure every model_id is `anthropic/claude-sonnet-4-5`. Don't introduce other models.
