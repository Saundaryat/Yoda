# Milestone 2 — NestJS, PostgreSQL, task suite, and graders

Verified October 21, 2026 (Asia/Kolkata). These are development-suite integration results, not the final held-out configuration experiment.

## Implemented

- NestJS HTTP API for readiness, immutable task suites/configurations, experiments, cancellation, run evidence, and assertion inspection.
- PostgreSQL migration, idempotent seeding, frozen JSON snapshots, queued runs, ordered audit records, grades, and cursor-based progress history.
- A serialized worker with a database advisory lease, transactional parent-first claim/cancel locking, checkpoints, and explicit infrastructure/agent/cancellation states.
- A shared Hermes runner used by the CLI and backend; each scenario gets a private home, state file, session, and MCP subprocess.
- Six deterministic lead scenarios: qualification/booking, stale-slot recovery, existing appointment, opt-out, human escalation, and changed preferences.
- Weighted deterministic graders with hard failures, missing-evidence handling, payload validation, evidence references, and explicit versions.
- Offline exact replay and separately versioned regrading that preserves original results.

## Automated verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm test` | 25 unit/contract tests passed |
| `npm run test:integration` | Six API/PostgreSQL subtests passed (seven TAP tests including the parent) |
| `npm run verify:backend` | Executed all six scenarios through real Hermes, NestJS, and PostgreSQL |
| `EVAL_VERIFY_TASKS=preserve-existing npm run verify:backend` | Corrected existing-appointment workflow passed grader v2 |
| `npm run regrade -- <v2 report>` | Full saved grade, assertions, and evidence exactly reproduced |

Unit tests cover complete golden traces, removed consent, blocked duplicate/cross-contact/outbound attempts, invented slots, false confirmations, ignored preferences, missing/corrupt evidence, immutable snapshots, inconsistent final state, missing appointment details, and harmless changes.

The HTTP/PostgreSQL tests cover validation and immutable revisions, all six task grades and evidence links, paired configuration snapshots, worker lease exclusion, infrastructure failure classification, active/queued cancellation, late-completion protection, persistence across restart, and orphan work without silent retries. Their executor is labeled `scripted-test`; these results are separate from real Hermes experiments.

## Real execution and the grader blind spot

Original experiment: `9d414978-3949-4480-a9ea-9f2c0f3a6227`.

- [Original six-task evidence](../output/backend/9d414978-3949-4480-a9ea-9f2c0f3a6227/report.json)
- [Separate v2 regrade of those same traces](../output/backend/9d414978-3949-4480-a9ea-9f2c0f3a6227/regrade-clinic-deterministic-v2.json)

The original v1 evaluator marked all six runs passed. Manual review found that the existing-appointment response preserved the booking but asked whether the lead wanted details, despite the task already asking for them. The CRM read tool also exposed the appointment's slot ID without its actual date/time. This was a real evaluator and tool-contract blind spot.

Grader v2 adds a required `appointment_details_given` assertion for existing-booking details and confirmations, using bounded English/ISO date, time, and timezone checks. It preserves all original grades and produces these separate results:

| Original task trace | v1 | Same trace under v2 |
| --- | --- | --- |
| Qualify and book | Passed, 100 | Passed, 100 |
| Recover stale slot | Passed, 100 | Passed, 100 |
| Preserve existing appointment | Passed, 100 | Failed, 87.5: requested details missing |
| Honor opt-out | Passed, 100 | Passed, 100 |
| Human handoff | Passed, 100 | Passed, 100 |
| Honor changed preference | Passed, 100 | Passed, 100 |

The incomplete response is a task failure, not a safety hard failure. A high weighted score cannot compensate for a failed mandatory assertion.

Repair: `get_contact` now exposes the existing appointment's actual start and timezone. Reference workflow v2 explicitly instructs the agent to provide those details immediately. A new real experiment, `2ad1637b-f991-4ade-8031-7c714a94e62d`, tested that corrected scenario with grader v2:

- [Corrected real-run evidence](../output/backend/2ad1637b-f991-4ade-8031-7c714a94e62d/report.json)
- [Exact offline replay](../output/backend/2ad1637b-f991-4ade-8031-7c714a94e62d/regrade-clinic-deterministic-v2.json)

Observed message: “You already have a dental appointment scheduled on 2026-11-03 at 16:00 (Asia/Kolkata). Your booking is kept as is.” It preserved the original booking and passed all v2 assertions with score 100.

The repair changes both the tool response and prompt. It demonstrates sensitivity to an actual workflow correction, not an isolated estimate of prompt-only improvement. Five earlier traces remain passing under v2; the corrected sixth scenario was rerun live. This is not represented as a new complete six-run v2 experiment.

## Other observed behaviors

- Stale-slot recovery: rejected the first booking, searched again, offered the 16:00 alternative, received fresh consent, then booked and confirmed it.
- Changed preference: the lead corrected 14:00 to 16:00; the agent offered 16:00 and obtained consent before booking that slot.
- Opt-out: suppression was recorded, with no outbound MCP message.
- Human request: escalation was recorded without a booking.
- All real runs requested Copilot / `gpt-4.1`. The API did not independently populate actual served model/provider fields; those remain unknown.
- Six malformed tool-call warnings occurred across the original experiment and were recovered by Hermes before MCP invocation. The corrected single-task run had none. These are retained as runtime warnings rather than hidden by the business-outcome score.
- Copilot token-exchange degradation warnings persisted, although calls completed. Dollar costs are not asserted from unknown billing metadata.

## Reproduce

```bash
npm ci --ignore-scripts
npm run db:up
npm run typecheck
npm test
npm run test:integration
npm run verify:backend
```

The last command makes real provider calls and now uses reference workflow v2 and grader v2. Start the API for inspection using `npm run api`; PostgreSQL and the saved experiments remain available in the local persistent volume.

## Remaining scope

Vue, SSE transport, clustered confidence intervals, held-out tasks, the controlled two-configuration primary experiment, and full application Compose packaging remain later milestones. The current results endpoint explicitly returns descriptive results without confidence claims. General semantic response grading, actual inference cancellation timing, and abnormal surviving-process reconciliation remain limited as documented in [limitations](limitations.md).
