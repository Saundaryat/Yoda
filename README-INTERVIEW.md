# Interview day
1. Run `make setup && make seed && make test && make eval` before the interview.
2. Start the demo with `make run`, then open `http://127.0.0.1:8000`.
3. No key is required; mock mode is deterministic and offline-safe.
4. For live Claude, set `ANTHROPIC_API_KEY` and `USE_LIVE_LLM=true` in `.env`.
5. Copy `SPEC_TEMPLATE.md` to `SPEC.md` and fill it after clarification.
6. Rename intents and functions in `app/agent.py` and `app/tools.py` for the domain.
7. Add domain cases to `evals/golden.jsonl`; keep the 80% gate.
8. Demo a happy path with `balance for CUST-001` and a handoff with `tell me a joke`.
9. Show `/logs` or the trace panel, then run `make eval` for the score table.

