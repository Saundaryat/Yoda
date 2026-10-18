# Project context

Interview build: deliver one explainable vertical slice in under 40 minutes.

## Fixed stack

- Python 3.11, FastAPI, SQLModel with SQLite, pytest, Anthropic SDK, python-dotenv.
- Vanilla HTML/CSS/JS frontend. No npm, Docker, Redis, Postgres, auth, or migrations.
- Live LLM use is opt-in with `USE_LIVE_LLM=true`; deterministic mock mode is the default.

## Working rules

- Build one feature per prompt, run `pytest -q`, then stop and summarize.
- State which files will change before editing; keep implementation files under 150 lines.
- Give every endpoint a test. Never log unredacted prompts, secrets, or PII.
- Ask at most one blocking question. Otherwise use the simplest choice and record it in `ASSUMPTIONS.md`.
- Add infrastructure or deployment files only when the interviewer asks.

## Layout

- `app/main.py`: API routes and static mount.
- `app/config.py`: environment settings.
- `app/models.py`: SQLModel tables.
- `app/db.py`: database engine and sessions.
- `app/llm.py`: Claude adapter and deterministic mock.
- `app/agent.py`: classify, authorize, call tool, respond, hand off.
- `app/tools.py`: registered demo tools.
- `app/guardrails.py`: PII redaction and tool allowlist.
- `app/logging_utils.py`: JSONL traces.
- `static/index.html`: chat and trace UI.
- `evals/`: golden cases and CI-style scorer.
- `tests/`: API and guardrail tests.
- `SPEC_TEMPLATE.md`: interview requirements template.
- `ASSUMPTIONS.md`: explicit assumptions made while building.

