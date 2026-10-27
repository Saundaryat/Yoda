# Experiment lifecycle

This page summarizes how experiments and runs move through their states. The detailed guarantees
are in [Experiment lifecycle and durable grading](../experiment-lifecycle.md).

## Statuses

| Record     | Statuses                                                  |
| ---------- | --------------------------------------------------------- |
| Experiment | `draft` → `running` → `finished`, or `cancelled`          |
| Run        | `queued` → `running` → `scored`, or `error` / `cancelled` |

A `scored` run can still have failed its checks, or be ungraded (`passed = null`). `finished` means
every run reached a terminal state, not that the scenarios passed.

## Create (draft)

`POST /api/experiments` validates two **different** configurations, known task ids and 1–10
repetitions, then saves a draft with an execution snapshot. **Nothing runs and nothing is spent.**

The snapshot freezes the inputs that would change results: configuration specs with their skill
contents, evaluator and comparison versions, judge and classifier models, customer model, turn
timeout and run budget. Credentials are never stored.

## Start

`POST /api/experiments/:id/start` locks the experiment row and, in the same transaction, creates
one run per scenario × configuration × repetition (a unique index protects each identity). The
experiment becomes `running` and the worker is kicked. Concurrent starts get one success and one
`409 Conflict`. A snapshot whose evaluator or grading models differ from the installed runtime
is rejected.

## The worker

`RunQueueService` runs inside the API process. It claims queued runs with
`FOR UPDATE SKIP LOCKED` and executes up to `RUN_CONCURRENCY` (default 3) at once. Each run holds
a Hermes gateway (~400 MB) while it runs.

Each run has two phases:

1. **Conversation.** Run Hermes against the customer. On success the transcript, CRM states,
   usage and context are committed as a checkpoint before grading starts.
2. **Grading.** Judge and score the saved conversation.

### Retries

- Retryable infrastructure errors (`timeout`, `crash`, `rate_limit`, `provider_error`) retry
  automatically up to `MAX_ATTEMPTS` (default 3) per phase. Backoff is 30 s × 2ⁿ for rate limits
  and 10 s otherwise.
- Execution retries start from a fresh Hermes home. Grading retries reuse the saved conversation and
  never restart Hermes or regenerate customer messages.
- `account` and `cost_cap` errors are not retried.
- The total attempt counter never resets, so retries never overwrite earlier `attempt-<n>` folders.

**Retry errors** (`POST /api/experiments/:id/retry-errors`) re-queues every `error` run in its
current phase. It is refused with 409 once the cost cap is reached.

## Cancel

`POST /api/experiments/:id/cancel` marks the experiment and its open runs `cancelled` and aborts
in-flight agent, customer, judge, review and classifier requests. Late results cannot overwrite a
cancelled run. Usage already returned is still recorded.

## Cost cap

Before claiming work and before grading, the worker compares recorded agent, customer and judge
spend against `MAX_EXPERIMENT_COST_USD` (default $25). At or above the cap, queued runs become
`error` with kind `cost_cap`. This is an admission limit on recorded estimates. Calls already
running can finish above it, and provider calls that never return usage are not counted.

## Restart and recovery

Run **one API worker per database schema**. On startup and on every poll the worker:

- cancels leftover work under terminal experiments,
- reclaims `running` runs that no live worker owns and resumes them in their current phase,
- finishes experiments whose runs are all terminal (idempotent).

Conversation, outcome and failure writes tolerate a lost commit acknowledgement, so retrying a
write never duplicates events or reopens a terminal run. A forced exit resumes from the last
committed conversation checkpoint.

## Live progress

`GET /api/experiments/:id/events` is a server-sent event stream: one message per run or experiment
state change, plus a heartbeat every 15 s. The UI treats messages as hints and reloads
authoritative state on every (re)connection, so missed events never leave the page stale.
