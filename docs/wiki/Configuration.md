# Configuration and costs

The API reads its settings from environment variables (`apps/api/src/config.ts`). With Docker,
put them in `.env` (git-ignored; copy from [`.env.example`](../../.env.example)). Compose sets
the paths and database URL for you.

## Model keys

| Variable            | Used for                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `ANTHROPIC_API_KEY` | Claude judge, LLM customer, and agent configurations with provider `anthropic` |
| `OPENAI_API_KEY`    | Agent configurations with provider `openai`                                    |
| `TYPESAFE_API_KEY`  | Optional Jev severity classifier for verified unsupported claims               |

Without `ANTHROPIC_API_KEY` there is no judge. The critical `reply-grounded` check is then skipped,
so runs stay ungraded. A missing provider key for a configuration fails its runs with an `account`
error.

## Models

| Variable      | Default             | Purpose                                                         |
| ------------- | ------------------- | --------------------------------------------------------------- |
| `JUDGE_MODEL` | `claude-sonnet-5-5` | Grades every reply; use a different model from the agent        |
| `LEAD_MODEL`  | `claude-opus-5-5`   | Plays the customer in `llm` mode                                |
| `JEV_MODEL`   | `jev-1.14.0`        | Pinned so evaluator decisions don't drift with a "latest" alias |

## Execution limits

| Variable                  | Default  | Purpose                                                                           |
| ------------------------- | -------- | --------------------------------------------------------------------------------- |
| `RUN_CONCURRENCY`         | `3`      | Runs in parallel; each holds a Hermes gateway (~400 MB)                           |
| `TURN_TIMEOUT_MS`         | `150000` | Hard limit per customer turn (Hermes's own budget doesn't stop a hung model call) |
| `RUN_BUDGET_SECONDS`      | `120`    | Hermes wall-clock budget per turn (`agent.run_budget_seconds`)                    |
| `MAX_ATTEMPTS`            | `3`      | Automatic attempts per phase for retryable infrastructure errors                  |
| `MAX_EXPERIMENT_COST_USD` | `25`     | Stop admitting work once recorded estimated spend reaches this                    |

## Server and paths

| Variable       | Default        | Purpose                                                   |
| -------------- | -------------- | --------------------------------------------------------- |
| `PORT`         | `3000`         | API port inside the container                             |
| `APP_PORT`     | `3080`         | Host port in Docker Compose                               |
| `DATABASE_URL` | required       | PostgreSQL connection string                              |
| `DB_SCHEMA`    | `public`       | Postgres schema for all tables (tests use throwaway ones) |
| `HERMES_BIN`   | `hermes`       | Hermes CLI (`/opt/hermes/bin/hermes` in Docker)           |
| `RUNS_DIR`     | `.runs`        | Per-run Hermes homes and CRM state                        |
| `SUITES_DIR`   | `../../suites` | Scenario files                                            |
| `SKILLS_DIR`   | `../../skills` | Skill library                                             |
| `WEB_DIST`     | unset          | Built web app to serve at `/`; unset in development       |

## Costs

All costs are **estimates** from usage the providers return; invoices are not queried.

- **Agent**: Hermes usage per turn (marked `unknown` when Hermes can't price it).
- **Customer**: LLM-customer calls in `llm` mode.
- **Grading**: judge, evidence-review and Jev calls, recorded per call across all retries.

The experiment's **Costs** page breaks these down and counts unknown estimates. Failed attempts
and provider-side retries may add spend that is never returned as usage.
