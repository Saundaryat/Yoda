# Architecture

Yoda is a pnpm monorepo (Node.js 22.18+, pnpm 11.21.0, TypeScript).

| Package           | Name            | Role                                                                                 |
| ----------------- | --------------- | ------------------------------------------------------------------------------------ |
| `apps/api`        | `@evals/api`    | NestJS API, run queue/worker, Hermes runner, scoring, analysis, migrations (Drizzle) |
| `apps/web`        | `@evals/web`    | Vue 3 + Vue Router single-page app built with Vite                                   |
| `packages/crm`    | `@evals/crm`    | Mock clinic CRM: state model plus an MCP stdio server exposing the CRM tools         |
| `packages/shared` | `@evals/shared` | Zod schemas and types shared by API and web (tasks, configurations, runs, analysis)  |

Other top-level folders: `suites/` (scenario YAML), `skills/` (skill library, one `SKILL.md` per
folder), `prompts/` (saved candidate instruction sets), `spike/` (the original Hermes feasibility
spike and its notes), `docs/` (reports, calibration and these pages).

## Runtime picture

```text
Browser (Vue SPA) ──HTTP /api, SSE──► NestJS API ──► PostgreSQL
                                        │
                                        │ RunQueueService (worker, in the same process)
                                        ▼
                         per run: fresh Hermes home + CRM state file
                                        │
                     hermes CLI turn ───┼──► model provider (OpenAI / Anthropic)
                                        │
                                        └──► MCP stdio: @evals/crm server (mcp__crm__* tools)
                                        │
                      after the conversation: Claude judge (+ optional Jev classifier)
```

In production (Docker) the API also serves the built web app from `WEB_DIST`; any non-`/api` path
returns `index.html` so the client router owns deep links. In development Vite serves the web app
on port 5173 and proxies `/api` to `http://127.0.0.1:3000`.

## API modules

`AppModule` wires these Nest modules (all under `apps/api/src`):

| Module / folder   | Responsibility                                                                       |
| ----------------- | ------------------------------------------------------------------------------------ |
| `db/`             | Postgres pool, Drizzle schema (`schema.ts`), runs migrations from `drizzle/` at boot |
| `suites/`         | Loads `suites/<suite>/<dev                                                           | eval>/*.yaml`, validates and lints them, verifies the frozen manifest, upserts task versions |
| `skills/`         | Reads the skill library from `SKILLS_DIR`                                            |
| `configurations/` | Creates and lists immutable, content-hashed agent configurations                     |
| `experiments/`    | Drafts, start, cancel, retry, run lists, grade changes, cost breakdown, SSE progress |
| `runner/`         | Worker queue, Hermes home seeding, Hermes CLI turns, scripted and LLM customers      |
| `scoring/`        | Task checks, CRM invariants, Claude judge, grounding review, Jev severity            |
| `analysis/`       | Paired-task bootstrap comparison and result labels                                   |
| `calibration/`    | Offline judge calibration against reference traces, and saved-conversation rescoring |
| `health/`         | `GET /api/health`                                                                    |

## How one run executes

`apps/api/src/runner/run-executor.ts` splits a run into two durable phases.

**1. Conversation (`executeConversation`)**

1. Create `RUNS_DIR/<runId>/attempt-<n>/` with a fresh Hermes `home/`, a `work/` dir and
   `crm.json`. The CRM seed from the task is materialized relative to the current date in the
   clinic time zone (`America/Chicago`), because Hermes writes today's date into its prompt.
2. Seed the Hermes home (`hermes-home.ts`): `config.yaml` (model, toolsets, MCP server pointing at
   the CRM with this run's state file), `SOUL.md` (the system prompt), skills under
   `skills/clinic/<name>/SKILL.md`, and an optional `memories/MEMORY.md` seed. Bundled skills,
   project discovery and background model calls are disabled.
3. For each session in the task, a customer (`LeadScript` or `LlmLead`) sends the opening message.
   Each customer message is one Hermes turn (`hermes-cli.ts`). The first turn starts a session;
   later turns resume it by `session_id`. A new session in a multi-session task reuses the same
   home and CRM, which is how continuity is tested.
4. After each turn the runner reads new messages from the Hermes SQLite store and new CRM audit
   entries, and appends `lead`, `tool`, `agent` and `note` events with a run-wide `seq`.
5. The customer decides the next message from the agent's reply; the session ends when the
   customer ends it or runs out of turns.
6. The gateway is stopped. The final CRM state, token usage, estimated cost, system prompts and
   memory files are captured, and the queue commits this conversation checkpoint.

**2. Grading (`gradeConversation`)**

The saved conversation is sent to the Claude judge (when `ANTHROPIC_API_KEY` is set), then
`scoreRun` combines task checks, judge reply checks and CRM invariants. Grading retries reuse the
saved conversation and never restart Hermes. See [Scoring](Scoring.md).

## Failure classification

`classifyTurn` turns a failed Hermes turn into an infrastructure error kind:

| Kind             | Cause                                | Retried automatically  |
| ---------------- | ------------------------------------ | ---------------------- |
| `timeout`        | Turn exceeded `TURN_TIMEOUT_MS`      | Yes                    |
| `crash`          | Hermes exited without a usage report | Yes                    |
| `rate_limit`     | 429 / rate limit / overloaded / 529  | Yes, backoff 30 s × 2ⁿ |
| `provider_error` | Any other provider failure           | Yes, 10 s backoff      |
| `account`        | 401/403, bad key, quota, billing     | No                     |
| `cost_cap`       | Experiment spend reached the cap     | No                     |

Agent-side endings (iteration or time budget reached, empty answer) are **not** errors: they are
scored as the agent's outcome.

## Database

Tables defined in `apps/api/src/db/schema.ts`:

| Table            | Contents                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `tasks`          | One row per scenario version: suite, key, `versionHash`, split, family, title, definition                                      |
| `configurations` | Name, description, `spec` JSON, `specHash`, frozen `skillContents`                                                             |
| `experiments`    | A/B config ids, task ids, repetitions, lead mode, status, analysis, `executionSnapshot`                                        |
| `runs`           | One per task × config × repetition: status, attempts, conversation checkpoint, grade, tokens, costs, CRM before/after, context |
| `run_events`     | The run timeline (`lead`, `agent`, `tool`, `note`) keyed by `seq`                                                              |
| `check_results`  | One row per check per run, with weight, critical flag, pass, detail and evidence                                               |

Migrations live in `apps/api/drizzle/` and are applied automatically at startup.
