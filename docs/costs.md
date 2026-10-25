# Usage and cost disclosure

The final comparison uses **native Anthropic / `claude-sonnet-4-6`**, not GitHub Copilot. Actual billed cost is **unknown**, not zero. There are no LLM-judge calls. Historical Copilot observations remain in their own exports and [archived report](final-experiment-v4.2-2026-10-25.md).

Anthropic publishes Sonnet 4.6 API prices of **$3 per million input tokens and $15 per million output tokens**. Published cache rates are $3.75/M for five-minute writes, $6/M for one-hour writes and $0.30/M for cache reads. These rates were checked October 25, 2026 against the [official model overview](https://platform.claude.com/docs/en/models/sonnet-4-6/overview) and [pricing documentation](https://platform.claude.com/docs/en/about-claude/pricing). [Dated machine-readable snapshot](../output/reliability/pricing-snapshot.json).

## Captured primary usage

Primary experiment `857ce98d-e957-4709-afd8-65f928828fb4` has 40 attempted scenarios, 38 graded, and **65 Hermes turns with numeric input/output counters**. Two startup failures have zero recorded inference turns. Missing requests, retries, cache categories or provider charges may be absent from these counters.

| Counter interpretation | Input tokens | Output tokens | Illustrative noncached arithmetic |
| --- | ---: | ---: | ---: |
| Maximum counter per scenario, summed | 1,029,375 | 21,104 | **$3.40** |
| All reported turn counters summed | 1,688,694 | 33,085 | **$5.56** |

These are alternative accounting interpretations, **not validated lower/upper bounds on the bill**. Session accumulation/reset and cache semantics have not been independently established; summing turn counters could double count. The arithmetic treats every reported input token as ordinary noncached input and applies the published rates, without claiming that this was the actual token mix or charge.

The separate four-scenario startup follow-up (`7454dcc5-0a02-4998-af58-7163ba001d94`) records 15 turns, all with numeric counters. Summed scenario maxima are 157,565 input / 2,638 output, or **$0.51** with the same arithmetic; summed turn counters are 415,997 / 7,275, or **$1.36**. It is a distinct experiment and does not change the primary denominator or cost figures. [Reproducible usage ledger](../output/reliability/anthropic-usage.json).

The latest **consent-workflow-v1 correction** (`609e00b1-4434-4d71-9993-c1236109118f`) is another separate four-scenario experiment. Its ten turns all have numeric counters: summed scenario maxima are 163,453 input / 3,051 output (**$0.54** illustrative arithmetic); summed turns are 326,521 / 6,084 (**$1.07**). Both use the same published-rate assumptions and unverified counter semantics above. This adds no runs to the primary denominator. Original and current grader replay make no model calls.

## Practical operating budget

For planning a similar forty-scenario native Anthropic comparison, allow roughly **$4–$6 of illustrative API usage under the recorded counter interpretations**, plus headroom for retries, longer conversations, token-category differences, and price changes. This is a workload illustration, not a spend cap or invoice estimate. Three repetitions would multiply these illustrative figures to about $10.21 or $16.69 before extra failures and retries. The platform supports three repetitions but the submitted experiment used one.

The credential-free `npm run review` path and video recording make **no model calls**. They use the existing computer and a local PostgreSQL container; no cloud-hosting subscription is needed. Hardware, electricity and engineering time are not valued in the API arithmetic. New live execution requires the evaluator’s own Anthropic account, permitted model and installed Hermes runtime; credentials are excluded from the package.

API results retain `estimatedCostUsd: null` and `costStatus: unknown`. Before enabling actual dollar metrics or cost per successful task, validate the invoice, served model, billable uncached/cache categories and retry accounting. The failed SDK setup, development pilot and older Copilot experiments are separate observations and excluded from the figures above. The earlier [October 21 cost document](costs-2026-10-21.md) is historical and contains explicitly hypothetical rates; it is not the current provider budget.
