# General Project Rules

## Security
- Never commit API keys or .env files
- Always use .env.example as the template
- Validate all user inputs (file uploads, chat messages)
- Sanitize filenames from uploads

## Git
- .env must be in .gitignore
- data/ directory should be in .gitignore (runtime data)
- Commit messages should be descriptive

## Code Style
- Python 3.11+ with type hints
- Async everywhere — no sync LLM calls
- Pydantic models for all data structures
- Structured logging, not print()

## Hackathon Context
- This is for the RNSIT Agentic AI hackathon (Problem Statement 3)
- Demo is 2 minutes — everything must work reliably
- Pre-cache a fallback result in case of API timeout during demo
- The "wow factor" is the multi-model agent pipeline visualization
