# Usage and cost disclosure

Measured October 25, 2026, for the [corrected full-suite experiment](final-experiment.md), `b4df0b6e-35ff-4db2-a7ec-1de92db49f46`. Actual Copilot billing/subscription allocation is **unknown**, not $0. Requested routing is Copilot / `gpt-4.1`; served metadata remains unavailable. No invoice or verified rate card is available, and there are no LLM-judge calls.

The export records **66 Hermes turns**: 58 usage objects contain numeric input/output counters and eight have missing counters. Those eight coincide with provider-limited infrastructure records. The API retains `estimatedCostUsd: null` and `costStatus: unknown`. Additional failed/retried provider requests may be absent from counters.

| Interpretation of available counters | Input tokens | Output tokens |
| --- | ---: | ---: |
| Maximum reported counter per scenario, summed | 538,629 | 8,667 |
| All reported turn counters summed | 878,295 | 14,283 |

These are two accounting interpretations, not verified lower/upper billing bounds. Missing usage is unknown. Session-counter accumulation/reset, cache and retry semantics have not been independently established; summing turns could double count.

## Practical operating budget

For an evaluator choosing a new individual subscription, budget **$10 USD per month for Copilot Pro**, plus any metered usage beyond the account's allowance. GitHub lists a base allowance of 1,000 AI credits for Pro; its current plan table also lists a variable flex allotment. These are published subscription terms checked October 25, 2026, not a claim about the account used in this experiment. [Official GitHub Copilot plans](https://docs.github.com/en/copilot/get-started/plans).

A simple planning allocation is **$2.50 per experiment if one $10 monthly seat is used for four experiments that month**, plus any overage. This allocates a fixed subscription; it is not a measured per-run charge, token price, or guarantee that four suites fit the allowance. Model availability, billing regime and account limits must be checked before live execution. We observed HTTP 429, so subscription access does not guarantee uninterrupted runs.

The evaluator's read-only `npm run review` path makes **no model calls** and therefore consumes no provider inference credits. It uses the existing computer and a local PostgreSQL container; no cloud hosting subscription is required. This does not value local hardware or electricity at zero. Live Hermes runs require the evaluator's own configured provider access.

The actual incremental charge for our saved experiment remains **unknown**. Do not multiply the exported token counters by invented API rates or equate a subscription allocation with an invoice. The earlier invented token-rate illustration is superseded by this subscription-based budget; archived October 21 planning figures remain historical. The separate six-attempt workflow validation was all HTTP 429 and is excluded from the source experiment counters above.

PostgreSQL, NestJS, Vue, MCP and Hermes ran on the existing local computer. The isolated experiment database was removed after the complete export was saved. Hardware, electricity, subscriptions and engineering time are excluded from this arithmetic. Historical runs and the targeted two-scenario rerun are separate observations and are not included here.

The [full export](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/report.json) preserves per-turn usage. The [verification artifact](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/verification.json) records both counter interpretations and missing-field counts. The [October 21 cost disclosure](costs-2026-10-21.md) is preserved separately.

Before reporting actual experiment dollar metrics, verify served-model metadata, counter semantics, cache categories, retries and the account-specific price schedule or invoice. Then use versioned price snapshots and cost per successful task rather than retrofitting guessed billing into these reports.
