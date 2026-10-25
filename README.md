# Tracework — Hermes Agent Evals

A local evaluation platform for comparing multi-turn Hermes agents. NestJS/PostgreSQL manage immutable experiments; Vue 3 shows paired results, uncertainty, and evidence-linked graders. Hermes runs externally against our isolated mock CRM/calendar through MCP. No real customer records are changed.

See [submission guide](SUBMISSION.md), [design](docs/design.md), [methodology](docs/evaluation-methodology.md), and [limits](docs/limitations.md). Historical milestone reports remain under `docs/milestone-*-verification.md`.

## Review the submission

Prerequisites: **Node >=22.18, npm, and running Docker**. From a fresh checkout or extracted package, run:

```bash
npm run review
```

Open **http://127.0.0.1:3001**. This installs locked dependencies, builds Vue, starts a separate review database on port 55434, and loads the saved real experiment with its v4.2 offline grades. The UI and API are read-only; no Hermes installation, provider credentials or model calls are needed. The evidence shows A 14/16 and B 13/16; eight provider errors are excluded. New workflow instructions are present in source but have not had fresh model validation. See [final results](docs/final-experiment.md) and [working-system video](output/demo/tracework-demo.webm).

Override `PORT` or `EVAL_DB_PORT` if needed. Stop with Ctrl-C. To remove only the default review database afterward: `COMPOSE_PROJECT_NAME=tracework-review EVAL_DB_PORT=55434 docker compose down --volumes`. This deletes the disposable review copy, not the exported evidence.

The final package also includes a complete Git bundle. To obtain a normal Git checkout from the extracted package:

```bash
git clone output/submission/tracework-source.bundle tracework
cd tracework
npm run review
```

## Start live experiments

Prerequisites: Node >=22.18, npm, running Docker, an installed Hermes checkout with MCP support, and usable provider credentials. The verified local setup requests Copilot / `gpt-4.1` using Hermes's existing credential resolution. Never commit provider secrets.

```bash
npm start
```

Open **http://127.0.0.1:3001**. Startup installs locked npm dependencies if absent, starts/waits for PostgreSQL, builds Vue, and serves UI/API from NestJS. Migrations/seeding are idempotent. This is host orchestration: Compose packages PostgreSQL only, not the complete app or Hermes. Initial credential/Hermes setup is not automated. Follow the [live runtime setup](docs/runtime-setup.md); the read-only review above is the credential-free evaluator path.

Verified Hermes commit: `349e4f7e620ea1be6a8b5703d7152cf1e5ed9998`. Place an installed checkout at `./hermes-agent` or set `EVAL_HERMES_ROOT`. Its `.hermes-dev/installs` selection facts locate the dependency interpreter. Other layouts can specify `EVAL_HERMES_BIN`, or `EVAL_HERMES_PYTHON` plus `EVAL_HERMES_RUNTIME_DIR`.

| Variable | Default / purpose |
| --- | --- |
| `DATABASE_URL` | `postgresql://evals:evals-local-only@127.0.0.1:55432/evals` |
| `PORT` | `3001`, loopback only |
| `EVAL_PROVIDER`, `EVAL_MODEL` | `copilot`, `gpt-4.1` for CLI comparison creation |
| `EVAL_HERMES_ROOT` | `./hermes-agent` |
| `EVAL_HERMES_BIN` | Optional installed Hermes executable |
| `EVAL_HERMES_PYTHON` | Optional dependency interpreter |
| `EVAL_HERMES_RUNTIME_DIR` | `<checkout>/.hermes-dev/tools` |
| `EVAL_API_URL` | CLI/demo API target, `http://127.0.0.1:3001/api` |
| `EVAL_CHROMIUM` | Optional Chromium executable for browser tests |

The database password is local-development-only; `.env` is optional and ignored. Requested model/provider are not proof of served metadata: this Hermes pin can leave actual runtime fields blank.

## Use

1. Inspect the six-task development or twenty-case evaluation suite. Importing JSON creates an immutable validated revision.
2. Save configurations with instructions and requested provider/model. Memory is disabled; tool allowlist and domain implementation remain fixed.
3. Create a draft experiment, choose configurations/repetitions, then explicitly click Run. Draft creation makes no model calls.
4. Follow persisted SSE progress with polling fallback. Cancel stops active execution and cancels queued work.
5. Compare macro task success, diagnostic score, hard failures, paired intervals, coverage, and configuration differences. Inspect failures down to tool arguments/results, lead consent, state snapshots, and assertion evidence.

The CLI creates a controlled recovery-instruction comparison and makes real provider calls:

```bash
npm run experiment
```

Default: `20 tasks × 2 configurations × 1 repetition = 40` scenarios, potentially multi-turn. Set `EVAL_REPETITIONS=3` before execution for 120 scenarios. Frozen protocol and exported real evidence are saved under `output/experiments/<id>/`. Different grader versions never form valid paired results.

To rerun only the slot-offer regression under the original A/B configurations, use an available PostgreSQL database with no other worker owning its schema:

```bash
node --env-file-if-exists=.env --import tsx scripts/rerun-task.ts output/experiments/9439a442-2a8a-4332-bb93-d3cb959763d6/report-reconciled.json recovery-missing-age
```

This makes two real Hermes scenario runs. It preserves the source task/provider/model, appends the same explicit text/slotIds agreement instruction to both configurations, and saves a new immutable protocol/export/summary. A still hands off after rejection; B still recovers and reconfirms. MCP tool descriptions also clarify that only explicitly offered slots belong in `slotIds`. Mismatches are rejected and audited, never silently corrected or excused by the grader. One task/repetition does not replace the full-suite experiment.

To run all twenty tasks using the already-corrected configurations from that targeted export:

```bash
node --env-file-if-exists=.env --import tsx scripts/rerun-task.ts output/experiments/e0755536-6344-4f45-9fca-a96cfde38b2e/report.json --full-suite
```

This creates forty new scenarios with one repetition per configuration, reuses the corrected configuration content hashes unchanged, and freezes the task list, analysis seed, grader version, runtime pin and implementation hashes before inference. Progress and partial exports are checkpointed alongside the final export.

To apply the subsequent `reliable-workflow-v1` correction for booking evidence, appointment IDs, opt-out silence and CRM reply delivery, add `--reliable-workflow`. It appends the same declared amendment to both configurations while preserving their recovery difference and records new hashes in the new experiment protocol. The [prepared revisions](output/configurations/reliable-workflow-v1.json) have synthetic regression coverage; fresh model execution is still needed to validate their effectiveness.

## Verify

```bash
npm ci --ignore-scripts
npm run typecheck
npm run typecheck:web
npm test
npm run db:up
npm run test:integration
npm run build:web
```

With the app running, `npm run test:web` checks navigation, draft/configuration creation, evidence inspection, and mobile overflow. It uses an existing Chromium when available; otherwise install Playwright Chromium (`npx playwright install chromium`) or set `EVAL_CHROMIUM`. Browser tests create a cancelled draft, not a synthetic agent performance result. Dev mode: `npm run api` and `npm run web` (port 5173).

Additional probes:

```bash
npm run verify:hermes
npm run verify:backend
npm run verify:cancellation
npm run verify:crash
npm run verify:startup
```

Hermes/backend/cancellation probes need real provider access. API integration tests use a labeled deterministic executor in a random PostgreSQL schema; they do not count as real agent results. Startup/cancellation verification also use isolated schemas. Crash verification terminates only its own host after real gateway readiness, before inference; mid-action cancellation is tested separately. Evidence: `output/reliability/`.

Offline replay makes no model calls:

```bash
npm run regrade -- output/experiments/<id>/report.json
```

Use `--allow-new-version` only for an intentional grader change; original reports remain unchanged. Current grader v4.2 checks message content and factual notes against prior evidence. It retains v4.1's "Reply YES to confirm" support and corrects the reviewed valid offer/confirmation/note paraphrases. Regrades save source/implementation hashes, assertion changes and recomputed frozen analysis separately. Historical grades remain historical; offline regrading does not execute revised prompts. See the [current results](docs/final-experiment.md) and [message and note rules](docs/evaluation-methodology.md#message-and-note-checks-in-v4).

## Architecture

```text
Vue → NestJS / PostgreSQL queue → isolated Hermes → CRM MCP
                                     ↑               ↓
                              next lead turn ← scripted driver
```

Each scenario gets a fresh home, session, CRM state, and MCP connection. Replies become subsequent user turns, not tool responses. CRM enforces qualification, consent, scope, availability, uniqueness, and suppression. Rejected unsafe attempts still fail policy checks. Complete CRM audits—not truncated Hermes previews—are authoritative.

PostgreSQL stores snapshots, checkpoints, lifecycle events, grades, and evidence. A database advisory lock permits one worker lane per schema. A liveness guardian terminates the isolated process group on cancellation or host death. Restart marks interrupted work as infrastructure errors; it never silently retries mutations. Private raw profiles/logs stay under ignored `.eval-runtime/`. Share curated exports only. Unknown usage/billing remains unknown, never zero.

## API

All routes below start with `/api`: `/health`; GET/POST `/task-suites`, `/configurations`; POST/GET `/experiments`; GET `/experiments/:id`; POST `/experiments/:id/start`, `/cancel`; GET `/experiments/:id/results`, `/diff`, `/export`, `/events?after=0`, `/stream`; GET `/runs/:id`, `/runs/:id/events`, `/runs/:id/grades`.

SSE `/stream` supports persisted replay using `Last-Event-ID`. `/events` is JSON cursor polling. Invalid definitions return 400, missing records 404, immutable/lifecycle conflicts 409. This is a loopback-only service without public authentication or team permissions.
