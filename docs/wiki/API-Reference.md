# API reference

The NestJS API serves everything under the `/api` prefix (port `PORT`, default 3000; mapped to
3080 by Docker Compose). Request bodies are validated with the Zod schemas in `packages/shared`.
Ids are UUIDs; a malformed id returns 400.

## Health

| Method | Path          | Returns                                                                                           |
| ------ | ------------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/api/health` | `{ database: 'ok' \| 'unavailable', hermes: version \| null, scoringVersion, comparisonVersion }` |

## Scenarios, skills and configurations

| Method | Path                      | Description                                                         |
| ------ | ------------------------- | ------------------------------------------------------------------- |
| GET    | `/api/tasks`              | Current scenario versions with group, session count and check count |
| GET    | `/api/tasks/:id`          | One scenario version, including its full definition                 |
| GET    | `/api/skills`             | The skill library                                                   |
| POST   | `/api/configurations`     | Create a configuration: `{ name, description?, spec }`              |
| GET    | `/api/configurations`     | List configurations                                                 |
| GET    | `/api/configurations/:id` | One configuration                                                   |

See [Agent configurations](Agent-Configurations.md) for `spec`.

## Experiments and runs

| Method | Path                                 | Description                                                                 |
| ------ | ------------------------------------ | --------------------------------------------------------------------------- |
| POST   | `/api/experiments`                   | Create a **draft**; nothing runs                                            |
| GET    | `/api/experiments`                   | List experiments with run counts, cost and published result                 |
| GET    | `/api/experiments/:id`               | One experiment summary                                                      |
| POST   | `/api/experiments/:id/start`         | Freeze inputs, create runs, start work (409 if not a draft)                 |
| POST   | `/api/experiments/:id/cancel`        | Cancel a running experiment (409 if not running)                            |
| POST   | `/api/experiments/:id/retry-errors`  | Re-queue `error` runs (409 if not running/finished or the cost cap is hit)  |
| GET    | `/api/experiments/:id/results`       | Comparison and per-scenario results; provisional while runs are open        |
| GET    | `/api/experiments/:id/grade-changes` | For rescored experiments: grade changes against the exact source runs       |
| GET    | `/api/experiments/:id/costs`         | Cost breakdown rows (agent, customer, grading) with unknown-estimate counts |
| GET    | `/api/experiments/:id/runs`          | Run summaries                                                               |
| GET    | `/api/experiments/:id/events`        | SSE progress stream (`ProgressEvent`, plus a `heartbeat` every 15 s)        |
| GET    | `/api/runs/:id`                      | One run with its scenario, configuration, events and check results          |

### Create an experiment

```bash
curl -X POST http://127.0.0.1:3080/api/experiments \
  -H 'content-type: application/json' \
  -d '{
    "name": "Preloaded policy vs available skill",
    "hypothesis": "Preloading the policy fixes same-day and insurance cases.",
    "baselineConfigId": "<config A uuid>",
    "candidateConfigId": "<config B uuid>",
    "taskIds": ["<task uuid>", "<task uuid>"],
    "repetitions": 3,
    "leadMode": "scripted"
  }'
```

`repetitions` is 1–10 (default 3); `leadMode` is `scripted` (default) or `llm`. Then
`POST /api/experiments/<id>/start` to run it. **Starting makes paid model calls.**

Shared response types (`ExperimentSummary`, `RunSummary`, `ExperimentResults`, `Comparison`,
`CostBreakdown`, `RunEvent`, `CheckResult`) are defined in `packages/shared/src`.
