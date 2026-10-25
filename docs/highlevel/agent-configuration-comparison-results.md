# Agent Configuration Comparison Results

**Project:** Tracework

**Experiment date:** 25 October 2026

The updated agent passed **95% of runs**, compared with **63.3% for the baseline**. The experiment tested whether a revised booking workflow and a different model improved an SMS appointment agent.

## Configuration changes

| Setting      | A — Baseline                            | B — Updated agent                                                                       |
| ------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Version      | V4 Customer preference recall           | V9 Guided booking with safeguards                                                       |
| Model        | Claude Haiku 4.5                        | Claude Sonnet 4.6 with medium reasoning                                                 |
| Instructions | Clinic policy and CRM preference recall | An ordered booking workflow, explicit consent checks and limits on unsupported promises |

Both used the same clinic policy, CRM tools and scenarios, with agent memory disabled. The model and instructions changed together, so this comparison measures the combined update.

## Test setup

- **Coverage:** 20 scenarios × 2 configurations × 3 repetitions = **120 scored runs**.
- **Execution:** Hermes agents, simulated customers and a mock dental clinic CRM.
- **Evaluation:** Tool and CRM checks, plus AI judgments of whether customer-facing replies matched the recorded evidence.

## Results

| Metric      | A — Baseline | B — Updated agent |
| ----------- | -----------: | ----------------: |
| Passed runs |     38 of 60 |          57 of 60 |
| Pass rate   |        63.3% |             95.0% |
| Failed runs |           22 |                 3 |

**Improvement: 31.7 percentage points.** The paired 95% confidence interval was **+13.3 to +51.7 points**, above the predefined 10-point improvement threshold. This supports an improvement on the tested suite.

The largest gains were in following clinic rules and handling returning customers. The recorded API cost estimate for the experiment was **$10.30**.

## Remaining failures and limits

B still failed three runs because its replies implied arrangements or outcomes that the CRM evidence did not support:

- A notification when a slot became available.
- A reserved slot after guardian confirmation.
- Guaranteed pricing details after a staff handoff.

The test used a reused synthetic suite and AI grading, which can make mistakes. These results do not establish reliability with real customers or isolate the separate effects of the model and prompt changes.

## Experiment evidence

[06 · Grounded SMS workflow · full 20-task A/B comparison](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f)

The evidence link requires the local app to be running.
