---
name: OpenRouter only - no Anthropic key
description: User has explicitly decided multiple times to remove Anthropic API key and route ALL LLM calls through OpenRouter only
type: feedback
---

No Anthropic API key in this project. ALL LLM calls must go through OpenRouter only.

**Why:** User does not want to manage two API keys. OpenRouter can proxy Claude models via `anthropic/claude-sonnet-4-6` model ID, so there's no need for direct Anthropic SDK usage.

**How to apply:** When touching config, llm_client, or agent model configs, ensure provider is always "openrouter" and never "anthropic". Remove any code that requires ANTHROPIC_API_KEY. All Claude model calls should go through OpenRouter's OpenAI-compatible API.
