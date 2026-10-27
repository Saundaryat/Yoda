# Reading results

Comparison statistics live in `apps/api/src/analysis/statistics.ts`; the current method is
**`paired-task-bootstrap-v2`** (`COMPARISON_VERSION`).

## Unit of analysis: the scenario

Each scenario runs _k_ times (repetitions) under A and under B. A scenario's pass rate is
passes ÷ scored runs. The headline difference is the **mean over paired scenarios of
(B rate − A rate)**, so every scenario counts equally however many runs it has.

Within a repetition, the order of A and B alternates by scenario and repetition, so neither version
always runs first.

## What the experiment page shows

| Result                   | Meaning                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------- |
| Observed pass rate       | Each version's pass rate, scenarios weighted equally after averaging repetitions    |
| A / B scored higher      | Which version had the higher observed pass rate in this test, or _Same pass rate_   |
| Confidence & methodology | 95% paired interval, verdict, wins/losses, sign test, minimum detectable difference |
| Scenarios                | Per-scenario results: where B improved, regressed or tied                           |
| Metrics & evidence       | Reply quality, performance metrics, tool usage, and the saved setup and hypothesis  |
| Costs                    | Estimated agent, customer and grading spend                                         |

## Uncertainty

- **95% interval**: a two-level bootstrap with 10,000 draws and a fixed seed, so the same data
  always gives the same interval. It resamples scenarios (which scenarios happened to be written),
  then runs within each scenario (run-to-run noise).
- **Wins / losses**: scenarios where B's rate beat A's and the reverse; ties are not counted. A
  two-sided exact sign test is reported on these.
- **Minimum detectable difference**: roughly the smallest true difference this design would detect
  80% of the time (2.8 × SD of per-scenario differences ÷ √n).
- **pass^k**: share of scenarios where _every_ run passed. It rewards consistency over lucky passes.

## Verdicts

The practical margin is **10 percentage points**: the smallest difference considered worth acting on.

| Verdict                    | Condition                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `incomplete`               | Experiment not finished, or some planned repetition on either side lacks a complete grade |
| `inconclusive`             | Fewer than 10 paired scenarios, or the interval straddles the margin                      |
| `better`                   | Interval lower bound > +10 points                                                         |
| `worse`                    | Interval upper bound < −10 points                                                         |
| `no_meaningful_difference` | Entire interval inside ±10 points                                                         |

A higher observed pass rate can still be **inconclusive**. That can be a true tie, too few
scenarios or repetitions, or scenarios that don't cover the change. It does not mean a scenario is
broken. Don't tune scenarios or weaken critical checks to produce a winner.

## Limits

The clinic suite is synthetic and its scenarios share rules and tools, so they are not independent
samples of real businesses. Intervals describe this suite under the bootstrap's resampling
assumptions, not production reliability.

## Worked example

The documented [Grounded SMS comparison](../experiments/2026-10-25-grounded-sms-v3.md) ran 120
runs: A (V4, Haiku 4.5) passed 38/60 (63.3%) and B (Grounded SMS v3, Sonnet 4.6) passed 57/60
(95.0%). The difference was +31.7 points with a 95% interval of +13.3 to +51.7: **better**. Prompt,
model and reasoning changed together, so the result doesn't isolate the prompt.
