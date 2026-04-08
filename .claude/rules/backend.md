# Backend Development Rules

## Agent Implementation
- Every agent MUST extend BaseAgent and implement: system_prompt(), build_user_message(), validate_response()
- Agent prompts are in prompts/templates.py — never inline prompts in agent files
- All LLM calls go through LLMClient — never import anthropic or openai directly in agents
- parse_response() handles markdown fences and regex JSON extraction fallback
- validate_response() must check response structure matches expected schema

## Orchestrator
- DAG execution order: Wave 1 (Classifier + Simplifier) -> Wave 2 (Risk + Benchmark) -> Wave 3 (Advisor)
- Use asyncio.gather with return_exceptions=True for parallel waves
- Classifier failure = pipeline failure (downstream agents depend on it)
- Simplifier failure = non-blocking (other agents don't depend on it)
- Advisor runs with whatever data is available from succeeded agents

## LLM Client
- Provider routing: "anthropic" -> AsyncAnthropic, "openrouter" -> AsyncOpenAI(base_url=openrouter)
- Always use call_with_retry() from agents — handles rate limits and transient errors
- Fallback: if primary model fails and fallback_model_id is set, try fallback via OpenRouter
- Log every call: model, tokens, latency, success/failure

## API Endpoints
- SSE events must be JSON with: agent, status, data (optional), timing_ms (optional), model_used (optional)
- File uploads: validate size and content type before processing
- Document dedup: check SHA-256 hash before storing

## Error Handling
- Retry transient errors (rate limit, 500) with exponential backoff
- Don't retry permanent errors (auth, bad request)
- Partial failure: return results from succeeded agents, mark failed as unavailable
- JSON parse errors: try regex extraction before raising AgentParseError
