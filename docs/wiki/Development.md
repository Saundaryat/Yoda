# Development and testing

## Local setup

Requirements: Node.js 22.18+, pnpm 11.21.0 (pinned via `packageManager`; `corepack enable` picks it
up), Docker for PostgreSQL, and a `hermes` binary on `PATH` (or `HERMES_BIN`) to execute real runs.

```bash
pnpm install --frozen-lockfile
pnpm dev:db     # postgres on 127.0.0.1:55433 (docker compose)
DATABASE_URL=postgres://evals:evals-local-only@127.0.0.1:55433/evals pnpm dev:api   # :3000
pnpm dev:web    # Vite on :5173, proxies /api to :3000 (override with API_URL)
```

For normal use, `docker compose up --build` (or `pnpm start`) is the complete runtime.

## Checks

| Command             | What it runs                                                         |
| ------------------- | -------------------------------------------------------------------- |
| `pnpm build`        | Builds every package (`nest build`, `tsc`, `vue-tsc` + `vite build`) |
| `pnpm typecheck`    | Type-checks every package                                            |
| `pnpm lint`         | `oxlint --type-aware apps packages`                                  |
| `pnpm format:check` | Prettier (`pnpm format` to fix)                                      |
| `pnpm test`         | Vitest unit tests in every package                                   |

Integration and browser tests need PostgreSQL:

```bash
pnpm dev:db
export DATABASE_URL=postgres://evals:evals-local-only@127.0.0.1:55433/evals
pnpm --filter @evals/api test:integration
pnpm --filter @evals/web exec playwright install chromium
pnpm --filter @evals/web test:e2e
```

These use fakes (`apps/api/test/fake-hermes.mjs`, `fake-judge.ts`, `fake-app.mjs`) rather than real
models, so they cost nothing and don't measure agent quality.

Generated JSON under `docs/experiments/` and `docs/calibration/` is excluded from Prettier to keep
its original bytes.

## CI

`.github/workflows/ci.yml` runs on every push and pull request:

- **checks**: install, format check, build, lint, typecheck, unit tests.
- **integration-and-e2e**: Postgres 17 service, API integration tests, Playwright (Chromium) e2e.
- **docker**: builds the production image.

## Database migrations

The schema is in `apps/api/src/db/schema.ts`; SQL migrations are in `apps/api/drizzle/` and run
automatically on API startup. After changing the schema, generate a migration with
`pnpm --filter @evals/api db:generate`. Migrations never rewrite historical results; see
[the lifecycle guide](../experiment-lifecycle.md#upgrading-existing-databases).

## Adding or changing scenarios

1. Add or edit YAML in `suites/clinic/dev/` (see [Scenarios](Scenarios.md)). Files are validated
   and linted on startup.
2. Don't edit `suites/clinic/eval/` in place. The frozen split is checked against `manifest.json`;
   changes need a new reviewed suite version and a calibration pass.

## Calibration and rescoring

Both are standalone scripts in `apps/api/src/calibration/`, built to `apps/api/dist/calibration/`.
They make paid API calls only with an explicit `--live` flag.

- **Calibration** (`run.ts`) judges reference traces built from the suite (correct and incorrect per
  scenario, plus wording variants) and writes match results, by default to
  `docs/calibration/latest.json`. Needs `ANTHROPIC_API_KEY` and `TYPESAFE_API_KEY`.
- **Rescoring** (`rescore.ts`) replays saved conversations from an existing experiment under the
  current evaluator into a new experiment linked to its source (`judge-and-score` or `score-only`,
  optionally a task subset). It never starts Hermes. The result's **grade changes** report compares
  each run with its exact source run. Requires an explicit `RESCORE_DATABASE_URL`.

## The Hermes spike

`spike/` contains the original feasibility work: a stub OpenAI-compatible model, a small MCP CRM
and a one-turn driver. `spike/NOTES.md` records verified Hermes behaviors the runner depends on:
throwaway homes, MCP tool naming, tool search hiding MCP tools, session resume, skill modes,
memory, rate-limit exit codes, and the fact that `run_budget_seconds` doesn't stop a hung model call.

## Project history

[docs/HANDOFF.md](../HANDOFF.md) is the dated implementation log with verification evidence.
Experiment protocols, results and screenshots are in [docs/experiments](../experiments/).
