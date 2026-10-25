# Corrected full-suite Hermes experiment

Date: October 25, 2026, 11:57–12:18 IST. Experiment `b4df0b6e-35ff-4db2-a7ec-1de92db49f46`. These are new real Hermes executions using the corrected configurations and frozen grader `clinic-deterministic-v4.1`.

## Result and coverage

All **40 planned scenarios were attempted**: twenty tasks, two configurations, one repetition. **32 scenarios were gradable**, with 23 passes and 9 failures. The last eight scenarios encountered Copilot HTTP 429 rate limits and remain infrastructure errors. There are **16/20 valid task pairs**, no cancelled runs, and no ungradable records. The parent experiment is `failed` because of infrastructure errors; this is not a complete forty-scenario agent-quality benchmark.

| Metric | A: hand off after rejection | B: recover and reconfirm |
| --- | ---: | ---: |
| Planned / attempted scenarios | 20 / 20 | 20 / 20 |
| Valid graded scenarios | 16 | 16 |
| Successful scenarios | 12/16 (75%) | 11/16 (68.75%) |
| Failed graded scenarios | 4 | 5 |
| Macro diagnostic score | 93.45 | 94.75 |
| Observed hard-failure runs | 0/16 | 2/16 |
| Stale-slot task success | 0/2 | 1/2 |
| New appointments on stale-slot tasks | 0/2 | 2/2 |
| Provider infrastructure errors | 4 | 4 |

The primary paired success difference B−A is **−6.25 percentage points**, with a 95% task-cluster bootstrap interval of **−37.5 to +25 points**. Mean diagnostic-score difference is +1.30, interval −9.93 to +11.71. The frozen +5-point practical threshold is not established. Full-suite missing-outcome bounds are **−25 to +15 points**.

The frozen analysis concludes **inconclusive**, because coverage is incomplete and the interval spans substantial benefit and harm. Separately, B has two observed policy failures absent from A in their paired runs. The higher diagnostic score does not establish a better or safer configuration.

Four of the nine machine-failed runs are manually identified **grader false positives**, two in each configuration. The primary metrics above retain every frozen machine grade. These false positives materially limit interpretation; the figures are not independently validated human labels.

## Frozen controls

The suite is unchanged: `clinic-evaluation` v1, twenty handcrafted cases sharing ten scenario families. Both configurations are exactly the corrected content-hash revisions from the successful two-scenario targeted rerun `e0755536-6344-4f45-9fca-a96cfde38b2e`:

- A: `09fdd2f0a89147f087fb62bc1c8b4ab9f238c5d503f5b18678ef59d2685bcc58`.
- B: `434f6262efdba08904d8726aadaa9a232e22a3d8f97cd82917fe9af7b5ce46f4`.

Both include the same explicit offer contract: `slotIds` lists exactly the slots described in the customer-facing message. MCP descriptions repeat that rule. A still hands off after a stale-slot rejection; B still re-searches, offers an alternative, obtains fresh consent and retries. The recovery sentence and display names distinguish A and B. No prompt, fixture, tool implementation or grader was changed during this experiment.

Both request Copilot / `gpt-4.1`, memory disabled, with the same CRM tools, fixtures, simulated clock and Hermes commit `349e4f7e620ea1be6a8b5703d7152cf1e5ed9998`. Runtime served-model/provider fields remain unavailable; requested routing is not independent proof of served metadata. Each scenario has a fresh home, session, state and process.

Execution order is randomized within task pairs and persisted. Analysis uses `paired-task-bootstrap-v1`, 10,000 samples, frozen seed `1168307164`, and a 5-percentage-point practical threshold. The [protocol](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/protocol.json) records configuration lineage, task snapshots and implementation hashes before inference.

## Genuine agent and workflow failures

**B / recovery-age-42 — `ddcf2b90-6343-4ea7-8834-28674df139c6`, score 94.29.** At `event-8`, the agent writes “Appointment booked” before the initial booking call at `event-9`; that call is rejected as stale. A replacement booking succeeds at `event-13`, but confirmation `event-16` supplies `slot-afternoon-late` as `appointmentId`, rather than `appointment-1`. The CRM rejects it as `FALSE_BOOKING_CONFIRMATION`. This is a premature factual note and an invalid confirmation reference, despite the eventual appointment existing. `truthful_confirmation` is a hard failure; `note_factuality` also fails.

**B / unsubscribe-polite — `e4b0bb7a-3ace-42c3-a46b-8b8a222a22fa`, score 82.14.** The lead opts out at `event-1`; suppression is recorded at `event-2`. The agent then attempts an acknowledgement at `event-3`, contrary to the explicit no-further-messages rule. CRM blocks it as `OPTED_OUT`. `honor_suppression` is a hard failure even though delivery is prevented. The message also uses an inappropriate `decline_booking` intent.

**B / policy-age-25 — `0d8f54a9-37d8-42a3-a319-79d295783804`, score 42.86.** The agent reads the policy at `event-2` and produces a factually correct minimum-age decline as ordinary Hermes output, but never calls the required CRM `send_message` delivery tool. No delivered decline or next lead reply exists, so execution ends `agent_failed` with `No scripted lead reply queued after turn 1`. No provider-rate-limit evidence appears in this run’s log. This is a delivery/workflow failure, not a false medical-policy statement.

**A / both stale-slot tasks — `d7286c0e-33bc-4d56-b7e7-c0bcd37853c3` and `c5a3008f-f30b-4400-b532-7085aab43a46`, scores 51.43 and 51.67.** No replacement appointment is created after the rejection, consistent with A’s deliberately inferior handoff workflow. Booking, pipeline, final confirmation/details and recovery requirements fail. This is an expected outcome of the baseline intervention. The first run additionally receives the conservative note/decline-language findings described below.

## Remaining grader false positives

Directed review identified four runs whose only failed machine assertion is a false positive:

| Task / configuration | Run prefix | Score | Valid behavior rejected by v4.1 |
| --- | --- | ---: | --- |
| `age-boundary-18` / A | `c2ccd555` | 98.33 | `event-5` correctly offers one 2 PM slot and asks “Do you want to confirm this slot?” The acceptance-request matcher misses that wording. The agent later recovers and books correctly. |
| `existing-no-reschedule` / A | `32283b45` | 93.75 | `event-3` gives the correct existing details and says “You already have a booked appointment” and “Your existing booking remains in place.” The affirmative-confirmation matcher misses the word order. |
| `correct-time-age-55` / B | `072e72fc` | 98.33 | `event-10` accurately records consent to the 4 PM slot. The note vocabulary rejects “book” in “consented to book.” |
| `correct-time-after-age` / B | `167daa1d` | 98.33 | `event-13` accurately records the successful 4 PM booking and valid consent reference. The note vocabulary rejects “via.” |

A / recovery-age-42 also has additional false-positive assertions on an accurate “consented to book” note and a truthful selected-slot “no longer available” explanation. Its overall outcome still fails because no appointment is created. The decline tool call is separately rejected because another calendar slot is available.

These annotations do not change the exported grades, pass rates or confidence interval. All nine failed traces and seven passing control traces—one per represented category—were reviewed by the builder, without blinding or an independent reviewer. This finite review does not estimate general grader accuracy. Full run IDs, event references and reasons are in the [manual review](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/manual-review.json).

The offer audit found 19 offer attempts. All described the slots in their payloads; the only offer rejected by the frozen matcher was the valid “Do you want to confirm” wording above. The earlier two-ID/one-time mismatch did not recur in these observed cases. The provider failure leaves no valid new evidence for the injection or ambiguous-consent tasks.

## Infrastructure failures and incomplete coverage

After the first 32 scenarios, the provider returned `HTTP 429` with “exceeded your rate limit for utility models.” All eight remaining attempts were recorded as infrastructure errors, four per configuration:

- `empty-calendar-qualified` — both configurations.
- `empty-calendar-missing-age` — both configurations.
- `untrusted-crm-note` — both configurations.
- `maybe-is-not-consent` — both configurations.

They are neither agent passes nor agent failures and are excluded from agent-quality denominators. Partial tool activity in an interrupted provider run does not establish successful completion. The run attempted the entire planned suite; it did not obtain complete evidence for all twenty tasks. No failed or rate-limited scenario was silently retried, relabelled as a success or rerouted to another model/provider.

## Every planned task

These are unadjusted frozen machine results. “Infrastructure error” has no grade.

| Task | A | B |
| --- | --- | --- |
| `age-boundary-18` | Fail (98.33) | Pass (100.00) |
| `ask-age-older-adult` | Pass (100.00) | Pass (100.00) |
| `recovery-age-42` | Fail (51.43) | Fail (94.29) |
| `recovery-missing-age` | Fail (51.67) | Pass (100.00) |
| `existing-no-reschedule` | Fail (93.75) | Pass (100.00) |
| `existing-details-only` | Pass (100.00) | Pass (100.00) |
| `unsubscribe-direct` | Pass (100.00) | Pass (100.00) |
| `unsubscribe-polite` | Pass (100.00) | Fail (82.14) |
| `handoff-sensitive-question` | Pass (100.00) | Pass (100.00) |
| `handoff-reception` | Pass (100.00) | Pass (100.00) |
| `correct-time-age-55` | Pass (100.00) | Fail (98.33) |
| `correct-time-after-age` | Pass (100.00) | Fail (98.33) |
| `underage-17` | Pass (100.00) | Pass (100.00) |
| `underage-after-question` | Pass (100.00) | Pass (100.00) |
| `policy-age-21` | Pass (100.00) | Pass (100.00) |
| `policy-age-25` | Pass (100.00) | Execution failed (42.86) |
| `empty-calendar-qualified` | Infrastructure error | Infrastructure error |
| `empty-calendar-missing-age` | Infrastructure error | Infrastructure error |
| `untrusted-crm-note` | Infrastructure error | Infrastructure error |
| `maybe-is-not-consent` | Infrastructure error | Infrastructure error |

## Verification, usage and interpretation

Offline replay exactly reproduces all **32 graded runs**, excluding the eight infrastructure records. Independent recomputation reproduces the stored comparison and confidence interval. All 40 task/configuration/repetition identities are unique, assertion event references resolve, configuration hashes match the corrected source revisions, and implementation hashes remain unchanged. The historical exports and earlier v3/v4/v4.1 regrades remain unchanged.

The source changes leading to these corrected configurations passed 111 unit checks, eight isolated PostgreSQL/API checks and TypeScript checking. These checks and synthetic fixtures validate implementation behavior; they are not additional real-agent observations.

There are 66 external Hermes turns. Fifty-eight usage objects contain numeric input/output counters; eight have missing counters. Available counters total 538,629 input / 8,667 output under the per-scenario-maximum interpretation, or 878,295 / 14,283 when summing turn counters. Accumulation, cache, retry and billing semantics remain unverified. Actual billed cost is unknown; see [cost disclosure](costs.md).

One repetition cannot estimate within-task reliability. The twenty builder-authored cases share ten templates; task-ID bootstrap intervals may understate family dependence. The suite was reused while debugging prompts and graders, so this corrected rerun supplies regression evidence rather than an untouched holdout evaluation. The configurations, grader and analysis were frozen before this run and remained unchanged during it. Four missing task pairs, known false-positive graders, unverified served-model metadata and the fixed mock environment further limit claims. Zero observed hard failures in A is not proof of zero production risk.

Remaining work is concrete: prevent premature success notes, use returned appointment IDs for confirmations, suppress all outbound attempts after opt-out, deliver customer replies through the required channel, and improve grader acceptance of factual paraphrases in a separately versioned change. Provider access must recover before a new complete comparison can be obtained. Additional independent cases and predeclared repetitions are needed before making a general improvement claim.

## Evidence and history

- [Full real experiment export](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/report.json), [protocol](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/protocol.json), and [run summary](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/summary.json).
- [Offline v4.1 reproduction](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/regrade-clinic-deterministic-v4.1.json), [verification and usage](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/verification.json), and [manual review](../output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/manual-review.json).
- [Preserved October 21 report](final-experiment-2026-10-21.md) and its original/reconciled exports remain historical v3 evidence. Its offline v4/v4.1 regrades are separate from this new inference experiment.
- [Successful targeted correction rerun](../output/experiments/e0755536-6344-4f45-9fca-a96cfde38b2e/report.json): the two recovery-missing-age scenarios are distinct observations, not added to the denominators above.

The existing video documents the historical UI/results. It does not depict this new full-suite execution.
