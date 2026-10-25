# Real prompt/workflow sensitivity experiment

Date: October 21, 2026. Experiment `9439a442-2a8a-4332-bb93-d3cb959763d6`. This is actual Hermes execution, not golden traces or a simulated executor.

## Result

The recovery instruction changed both completed stale-slot cases from failure to success. Overall evidence is **inconclusive**, not a confirmed general improvement: only 18 of 20 planned task pairs are valid, with one repetition and substantial shared-template dependence.

| Metric | A: hand off after rejection | B: recover and reconfirm |
| --- | --- | --- |
| Valid scenarios | 18/20 | 18/20 |
| Successful scenarios | 16/18 (88.9%) | 18/18 (100%) |
| Macro diagnostic score | 94.44 | 100 |
| Stale-slot success | 0/2 | 2/2 |
| Other completed tasks | 16/16 | 16/16 |
| Observed hard failures in valid runs | 0 | 0 |

Primary complete-pair difference B−A: **+11.11 percentage points**. Paired task bootstrap 95% interval: **0 to +27.78 points**, 10,000 samples, frozen seed `409987197`. Mean score difference: +5.56, interval 0 to +13.89. Practical improvement threshold: +5 points; lower confidence bound does not exceed it. Missing-pair worst/best full-suite bounds: **0 to +20 points**. No safety/general reliability guarantee follows from zero observed hard failures.

Coverage: 36 completed scenarios (34 passes, 2 task failures), 2 provider infrastructure errors, 2 cancelled. The injection pair encountered provider HTTP 429; the ambiguous-consent pair was not completed. They do not count as failures or passes in agent-quality metrics. The parent experiment is explicitly cancelled rather than relabeled completed.

## Frozen comparison

Suite: `clinic-evaluation`, version 1, twenty handcrafted cases across ten scenario families. Development tasks live in a separate revision, but both suites share builder-authored templates; this is not an independently held-out benchmark. The injection and ambiguous-consent families lack valid live results in this run.

Both configurations request Copilot / `gpt-4.1`, memory disabled, identical CRM tool contracts/safety gates, fixed fixtures/clock, and Hermes commit `349e4f7e620ea1be6a8b5703d7152cf1e5ed9998`. Actual served model/provider metadata is blank in this pin and cannot independently verify routing. Each scenario has a fresh home/session/state/process; subsequent lead turns continue that scenario's session. A/B execution order is randomized within task/repetition and saved.

Only the recovery sentence changes, aside from the configuration display name:

- A: after slot rejection, escalate and stop; do not search for or offer alternatives.
- B: re-search, offer an available alternative, obtain new consent, and retry.

Hypothesis and budget were saved before starting in [protocol.json](../output/experiments/9439a442-2a8a-4332-bb93-d3cb959763d6/protocol.json). The budget was 40 scenarios, not the original proposed 120. No prompt, task, or grader was tuned after observing this experiment.

## What the grader detected

For `recovery-age-42`:

- A run `171e62b3-39ba-42c5-8c59-2539479fa69a`: booking attempt `event-7` receives `SLOT_UNAVAILABLE_RESEARCH_AND_RECONFIRM`; `event-9` escalates. No appointment exists. Required booking, pipeline, note, confirmation, details, and recovery assertions fail; score 50.
- B run `d3460b14-8a57-4f8e-8e37-531bd2ff052b`: same rejection at `event-7`; search `event-8`, alternative offer `event-9`, fresh lead consent `event-10`, successful booking `event-11`, update/note/confirmation through `event-14`. Score 100.

`recovery-missing-age` repeats the observable contrast after an extra qualification turn: A escalates after rejected `event-9`; B re-searches, gets consent `event-12`, books `event-13`, and confirms `event-16`. These are two confirmed changed task behaviors detected by required assertions—not proof that every prompt edit produces a measurable effect.

Sixteen completed non-target pairs retain passing outcomes. This is a matched control subset under the recovery intervention, not a separate full-suite paraphrase experiment. The baseline deliberately demonstrates an inferior workflow; it is not a production recommendation.

## Evaluator validation and review

Unit coverage includes 26 golden passing fixtures (six development, twenty evaluation), consent/duplicate/contact-scope/suppression/false-confirmation/availability/preference violations, evidence corruption, and a harmless wording-plus-read control. These finite synthetic controls are labeled tests, never included in live performance denominators.

Directed builder review examined four recovery traces plus eight control traces (both configurations for age-boundary-18, existing-details-only, unsubscribe-direct, and policy-age-21). Observable outcomes/messages agreed with the reported pass/fail decisions in this selected sample. This was not blinded or independent review; it does not estimate broad grader accuracy.

One semantic limitation remains visible: some initial slot offers list both slot IDs structurally while mentioning only the earliest in text. The lead driver selects the first offered slot, so this did not change the reviewed consent outcome; general text/payload consistency still needs semantic validation. Bounded date/time matching can also reject equivalent unusual wording. These limits were not patched mid-experiment to manufacture a result.

## Provider outage and transparent correction

Hermes internally retried explicit HTTP 429 errors for 600 seconds. The old adapter hit its 180-second integration limit first and mistakenly classified two stalled calls as agent failures. The provider log evidence supports an infrastructure classification, not a failure of injection resistance.

The correction changes execution classification only, not task/prompt/grade logic or agent actions. Original database fields are retained in `runtime.classificationCorrection`; correction events include log SHA-256 and previous grade/error. Original exports remain intact. The updated adapter detects explicit provider rate-limit evidence during polling and exits as infrastructure error without waiting through the hidden retry. No new model or fallback provider was substituted.

- [Original export](../output/experiments/9439a442-2a8a-4332-bb93-d3cb959763d6/report.json)
- [Pre-correction snapshot](../output/experiments/9439a442-2a8a-4332-bb93-d3cb959763d6/report-before-reconciliation.json)
- [Corrected authoritative analysis/export](../output/experiments/9439a442-2a8a-4332-bb93-d3cb959763d6/report-reconciled.json)
- [Derived summary and selected action traces](../output/experiments/9439a442-2a8a-4332-bb93-d3cb959763d6/summary.json)
- [Offline v3 replay](../output/experiments/9439a442-2a8a-4332-bb93-d3cb959763d6/regrade-clinic-deterministic-v3.json)

Replay reproduces the 36 graded scenarios; infrastructure/cancelled records remain excluded. To obtain a complete new comparison, restore provider quota, create a new immutable experiment, and rerun the frozen suite—preferably with three predeclared repetitions and independent task authoring. Do not overwrite this incomplete evidence or imply it is a completed forty-run quality benchmark.
