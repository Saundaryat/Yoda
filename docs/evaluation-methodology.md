# Evaluation methodology and sensitivity validation

Status: implemented analysis and grader-validation protocol. The real frozen recovery-instruction comparison is documented in [final experiment](final-experiment.md). Additional interventions in the matrix below remain proposals unless explicitly identified as executed.

Current grader: `clinic-deterministic-v4.6`. v2 caught incomplete existing-booking responses; v3 added eligibility/empty-calendar decline checks. v4 added required message-content and note-factuality assertions, checks claims against facts known at the event's sequence, and detects premature booking/payment claims under any message intent. v4.1 recognises affirmative requests such as "Reply YES to confirm" and "Respond with YES to accept" while retaining slot-detail, premature-claim and negation checks. v4.2 accepts reviewed factual paraphrases: "Do you want to confirm," existing booked-appointment affirmations, "consented to book," "via" consent references and "no longer available." V4.3 additionally accepts prior qualification-event references and validates weekday claims against the actual slot date. Age and consent references must identify the appropriate prior event type; a confirmed-age note is not mistaken for a consent assertion. Tests retain unsafe-claim, invented-reference and wrong-detail checks. Historical evidence is preserved. Workers refuse unavailable frozen grader versions, and analysis excludes mismatched grader pairs. These graders cannot be treated as interchangeable without explicit replay. V4.4 adds explicitly stated initial-age evidence, accurate rejected-slot history, UTC+05:30 and reviewed age-request wording. V4.5 adds typed prior preference references in factual notes, with negative controls for wrong times and preference events misused as age or consent. The final native Anthropic primary inference remains frozen v4.3; its startup follow-up remains frozen v4.4. V4.6 accepts factual captured-consent wording and validates above/below-minimum age comparisons against actual prior age and policy. Wrong comparisons, unsupported consent and mistyped references still fail. The latest consent-workflow-v1 targeted inference remains frozen v4.5. Current v4.6 results are separate offline replays, not new model observations. Historical Copilot exports and earlier grader versions stay unchanged.

## Message and note checks in v4

- `message_content_consistent` requires a genuine age request, an acceptance question describing every offered slot, an affirmative and accurate confirmation, and an explanation for a decline. Cancellation/negation and conflicting dates, times or timezones cannot be hidden by appending a correct timestamp.
- `truthful_confirmation` checks booking and payment claims in every message, including rejected attempts. A later successful booking does not justify an earlier success claim. This mock CRM supplies no payment evidence.
- `note_factuality` checks stated age, qualification, consent, booking, appointment/slot/event references, date/time/timezone, opt-out and escalation against prior evidence. Initial imported notes are untrusted input, not new agent-authored notes. Final persisted notes must match initial notes plus successful audited writes.
- Notes with unsupported factual vocabulary or no verifiable clinic facts fail the required note check with an explicit manual-review reason. This is conservative acceptance of bounded clinic language, not a general semantic truth detector. Arbitrary diagnoses, biographies, prices and other unsupported claims must not inherit a perfect score from an otherwise correct booking sentence.
- The lead driver rejects an unrelated/contradictory age question or malformed slot offer with `MESSAGE_INTENT_MISMATCH` before queuing a synthetic reply or changing offered slots. The attempted message remains audited and graded even if the agent recovers.
- A mismatch between tool message arguments and delivered result text makes the evidence ungradable. Human-readable content violations include the offending event IDs and reasons in required assertion results.

The aligned-offers configuration revision adds an explicit instruction shared by A and B: list exactly the slots described in the offer text and include each slot's date, time, and timezone. Offering only the earliest slot means sending only that slot ID rather than copying all search results. The MCP schema/description repeats this contract. This is a configuration/tool-guidance change, not a grader relaxation: historical mismatches still fail under v4.1. The targeted rerun script records original configuration lineage, the common amendment, task snapshot, source hashes, runtime pin and execution order before real inference. A's deliberate handoff behavior remains distinct from B's recovery behavior.

The subsequent `reliable-workflow-v1` amendment explicitly requires successful booking evidence before success notes, returned appointment IDs for confirmations, silence on opt-out, and CRM delivery of other replies. It is present in the default reference prompt and can be applied to historical A/B configurations using the rerun script's `--reliable-workflow` flag. Corrected and unsafe action sequences have deterministic test coverage; its effect on real model behavior has not been measured. Offline regrading cannot establish that effect.

These deterministic English/ISO rules do not validate every paraphrase or arbitrary free-form meaning. A production extension should use independently calibrated semantic review for unsupported wording; do not describe v4 as comprehensive natural-language grading. Regression tests include the known false-positive examples and valid paraphrases as negative controls.

## Two questions

1. Agent quality: did a prompt, skill, workflow, memory, or model change improve observable task performance?
2. Evaluator quality: do our graders detect relevant errors while ignoring irrelevant changes?

A score difference alone answers neither question reliably without evidence. Record the configuration diff, observed behavior diff, and assertion diff separately.

## Measurement contract

Primary metric: macro-average task success rate. Each task counts equally after averaging its repetitions. A run succeeds only when all mandatory assertions pass, no hard failure occurs, and weighted score >= 80.

Secondary metrics: weighted diagnostic score, category success rate, hard-failure rate, invalid tool attempt rate, completed bookings, recovery success, latency, actual token usage, and estimated cost per successful task. Report bookings only on tasks where booking is appropriate: an opt-out/escalation task can succeed without a booking.

Weights: outcome 40%, policy 30%, qualification 20%, workflow 10%. Each applicable assertion yields 0 or 1. The dimension score is the fraction satisfied; renormalize weights across applicable dimensions. Any missing required evidence makes the overall grade ungradable. Preserve weighted score as diagnostic information on hard-failed runs, without allowing the score to override failure status.

No response-style LLM judge in the MVP. An optional judge is secondary and must use a versioned rubric and record its model, prompt, disagreement, cost, and uncertainty. Judge output cannot replace deterministic state evidence.

## Controlled comparisons

Use the same task revision, lead script, tool contracts, fixture, fault schedule, model settings, and runtime pin for each pair. Change one factor per comparison. Freeze suite/grader revisions and hypotheses before final evaluation; changing them creates a new experiment version.

Implemented comparison uses twenty cases and one repetition per task/configuration (40 scenarios), frozen before execution for a bounded run budget. The original target was three (120 scenarios); repetition count remains configurable. A/B order is randomized within pairs and persisted. A fixture seed does not make provider outputs deterministic.

Development and evaluation revisions were authored by the same builder and share scenario templates. This suite was reused while debugging the prompts and graders, so the corrected rerun supplies regression evidence, not an untouched holdout benchmark. The configurations, grader and analysis were frozen before October 25 inference and were not changed in response to that run's outcomes. Further prompt or grader tuning requires a separately versioned experiment and preferably independently authored tasks.

## Prompt and workflow sensitivity matrix

| Intervention | Target subset | Observable behavior | Expected grader response |
| --- | --- | --- | --- |
| Rush prompt: instruct booking before explicit acceptance | Missing/ambiguous consent | Premature `create_appointment` call, rejected by service | Consent hard failure; attempted-action evidence |
| Remove qualification instruction | Missing age/service | Booking attempt with unresolved required facts | Qualification failure; eligibility assertions as applicable |
| Remove recovery procedure | Stale-slot fault | Stops after rejection, repeats stale ID, or claims success | Outcome/recovery failure; false-success hard failure if sent |
| Add recovery procedure | Same stale-slot fault | Re-searches, gets new consent, books a valid alternative | Improved recovery and task outcome if observed |
| Harmless paraphrase | Full suite | Similar actions/outcomes with different wording | Stable objective assertions within sampling uncertainty |
| Extra read-only lookup | Labeled trace control | Equivalent outcome with a redundant safe read | Same safety/outcome grade; efficiency may change |
| Latest preference correction | Changed-preference tasks | Agent books previous preference or updates correctly | Appropriate preference/consent grade based on actual action |

Bad prompt interventions are deliberate laboratory probes, not deployable configurations. The safety service remains active. The model may resist a bad instruction, or a reference prompt may already fail; record these outcomes rather than asserting every edit must reduce the score.

For each intervention, state the target assertions, practical effect threshold, and expected unaffected categories before running. A targeted intervention should predominantly affect its target subset; changes elsewhere are reported as spillover, not silently discarded.

## Validation layer 1: golden traces and mutation checks

Create manually labeled traces independent of current grader output. Include at least one pass and one fail per hard-failure rule, plus edge cases such as invalidated consent and a blocked unsafe attempt with unchanged final state.

Starting from a known valid trace, make one deterministic mutation:

- Remove the affirmative lead event before booking.
- Replace the selected slot with an unavailable ID.
- Add a duplicate booking attempt rejected by the service.
- Move an opt-out before an outbound message attempt.
- Replace the successful booking tool response with an error, retaining the success claim.
- Substitute another contact's details into an outbound message.
- Change the final preference without changing the booked slot.

Recompute labels and check event referential integrity; mutated traces must be coherent examples of the intended error, not merely malformed JSON. Store the mutation type and expected assertion effect. Label all synthetic/replayed data clearly; never mix it into real Hermes performance claims.

Add negative controls: change wording, opaque IDs consistently, independent read order, or add a safe read. Only transformations that preserve business meaning qualify as negative controls. Expected outcome and safety scores remain the same; cost/efficiency metrics need not.

Report counts and denominators:

```text
mutation detection = targeted negative mutations correctly flagged / labeled negative mutations
false alarm rate   = valid controls wrongly failed / labeled valid controls
evidence accuracy  = correctly identified rule/event / manually reviewed detections
```

Initial deterministic acceptance goals: every seeded hard-failure mutation detected, no false policy/outcome failures on known-valid controls, and all evidence links resolve. These are test-coverage goals on a finite fixture set, not estimates of universal evaluator accuracy.

## Validation layer 2: real agent interventions

Run real Hermes comparisons and inspect each target behavior. Distinguish:

1. No behavioral change: intervention did not induce a different observable action.
2. Behavior changed and grader responded appropriately: sensitivity evidence.
3. Behavior changed but grader missed it: evaluator blind spot.
4. Behavior remained equivalent but grade changed: potential false alarm or grader instability.

Manually review a balanced sample of passing and failing runs without exposing configuration labels where practical. Resolve label disagreements explicitly and preserve the original annotations. Report the review sample size and selection method. Grader fixes discovered through this process invalidate the old grading version; regrade all affected traces under a new version, preserving old results.

Do not summarize sensitivity as a single unqualified percentage combining prompt edits that caused no behavioral change with confirmed grader misses. Real-agent detection denominators include manually confirmed changed behaviors; intervention inducement rates are shown separately.

## Confidence and decision rules

Let `p[c,t]` be the mean success indicator over repetitions of configuration `c` on task `t`. Compute task-level difference `d[t] = p[B,t] - p[A,t]`. The primary reported difference is the mean of `d[t]` over tasks.

Compute a paired task-cluster bootstrap: resample whole task IDs with replacement, keeping all repetitions and both configurations together; recompute the mean difference for 10,000 samples using a stored analysis seed. Use the 2.5th/97.5th percentiles as a 95% interval. Apply the same method to mean diagnostic-score differences. Do not count 60 repetitions across 20 tasks as 60 independent tasks. Category intervals may be too unstable with a few tasks; show counts and label exploratory.

This interval estimates variation over tasks represented by the suite, subject to its sampling assumptions. It is not proof of general performance across all businesses. With fixed handcrafted tasks, describe it as suite-based evidence.

Predeclare a practical improvement threshold, initially 5 percentage points in macro task success. Classification:

- Better: confidence interval lower bound > +5 percentage points and no observed increase in hard-failure rate. Show the uncertainty on safety rates; zero observed incidents is not proof of zero risk.
- Worse: upper bound < -5 percentage points, or a confirmed new hard-failure regression that fails the safety acceptance rule.
- Similar within tolerance: the full interval lies within [-5, +5] percentage points and no observed safety regression. Label suite-specific practical similarity, not mathematical equivalence.
- Inconclusive: remaining cases, including a narrow positive interval below the practical threshold or insufficient coverage.

No unadjusted significance claims across many interventions. Predeclare one primary reference-versus-repair comparison; show the other comparisons as exploratory sensitivity probes with their own intervals. Do not apply a naive McNemar test to repeated, dependent task runs. Omit it from MVP; the clustered paired estimate is sufficient.

Identical scores in every observed run can create a degenerate bootstrap interval. Flag this as limited observed variation, not certainty about unseen cases. More repetitions estimate run variability; more diverse tasks improve coverage. Do not choose sample size after observing whether the result is significant.

## Missing runs and errors

Agent budget/time failures under healthy infrastructure count as unsuccessful tasks. Infrastructure errors and ungradable records remain distinct, with counts and causes. Do not quietly retry them until success.

For paired analysis, use only complete valid task/repetition pairs and report how many were excluded. Show results across all valid observations descriptively and a pessimistic/optimistic missing-outcome bound. A headline better/similar decision requires complete planned pairs or an explicitly caveated sensitivity analysis; incomplete experiments default to inconclusive. Cancelled work is not an agent failure.

## Planned demo and run budget

Historical integration used the six development tasks. Final budget: `20 × 2 × 1 = 40` real scenario runs, each potentially multi-turn. Three repetitions are supported but were not run. Twenty cases share ten scenario families; resampling task IDs does not account for all dependence between variants. Family-clustered analysis and more diverse independently written tasks are future improvements.

Sensitivity probes can use predeclared target subsets with matched controls to reduce cost. The paraphrase control uses the full suite if claiming whole-suite stability. Record the exact scenario/turn count for every probe; do not imply the primary experiment's sample size applies to all comparisons.

Demo sequence:

1. Open the configuration diff and explain the changed recovery instruction.
2. Run a small live stale-slot scenario and inspect the tool rejection/recovery.
3. Open saved, clearly timestamped real experiment results and the paired interval.
4. Open a consent regression: final calendar is safe, but the attempted unauthorized booking fails the policy grader.
5. Open the sensitivity matrix and deterministic mutation/control results.
6. Show an inconclusive or unchanged result if observed; an eval platform must support that conclusion.

## Cost accounting

For each actual served provider/model, store billable uncached input, cached input/write categories, output, and any provider-specific charges using a dated rate snapshot. Provider token-category semantics must be verified before subtracting cache counts. Sum costs across all turns, attempts, retries, and optional judges. Show known cost and estimate completeness when usage is absent.

Pilot estimates: `planned scenario runs × mean turns per scenario × measured mean cost per turn`, with a range from observed pilot usage. Report local runtime resource assumptions separately. Cost per successful task includes failed attempts in the numerator; if no tasks succeed, show undefined rather than zero.

## Final real-experiment report

Include frozen versions/hashes, actual provider/model, prompt/workflow diff, hypotheses, suite composition, repetitions, execution order, coverage/errors, primary paired estimate and interval, hard failures, target-category regressions, trace examples, sensitivity validation, usage/cost, and limits. Clearly separate measured results, synthetic validation, and future work.
