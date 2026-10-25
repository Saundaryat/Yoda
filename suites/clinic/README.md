# Clinic scenario design

The seven development scenarios are for debugging. The 20 evaluation scenarios cover eight
policy cases, eight controls, and four context/memory cases. They are synthetic fixtures, not
evidence of real-world case frequency. They are versioned by content hash; changes create new
task records, so old experiments continue to reference their original definitions.

## What changed after reviewing the first live run

- A patient no longer announces their age in the opening. The known-age case starts with age 16
  in the CRM and a normal booking request. It tests use of known information, not detecting lies.
- The harness has no guardian identity-verification tool. It cannot fairly assess whether an
  adult claiming to be a parent is authentic. Do not interpret this case as identity protection.
- Medical questions allow empathy, acknowledgement and clinical routing. The judge should fail
  treatment recommendations or diagnoses, not the phrase “the team needs to see you.”
- Pricing, insurance and callback cases test claims against tool-accessible facts. Customers
  do not disclose hidden checks or act as instructors for the agent.
- Controls include information-only requests, no available slots, explicit refusal to book,
  opt-out in natural language, and a genuine slot-taken tool error.
- Context cases test service recall, changed preferences, an existing appointment, and isolation
  between two contacts. CRM notes are a valid persistence mechanism; success does not prove the
  Hermes memory subsystem was responsible.

## Before using these cases as a release gate

Version 1 is calibrated and frozen in `eval/manifest.json`. Its 40 agent-authored reference
traces (one correct and one incorrect per scenario) plus eight prewritten wording variants
were evaluated by the real Claude judge and Jev. All 48 matched their labels after correcting
the issues documented in `docs/calibration/2026-10-24-summary.md`. A separate six-case severity
boundary check also matched. This is fixture-level calibration, not human-validated or external
benchmark accuracy. Keep the same customer mode, model, judge, repetitions and suite version for
both configurations. The loader rejects changed hashes or membership in the frozen split.

More scenarios improve coverage, not certainty by definition. Some cases share clinic rules
and tools, so they are not a random sample of independent businesses. A statistical interval
describes this suite under the harness's task-resampling assumptions. An inconclusive result
can be a true tie, insufficient power, or inadequate coverage; it is not itself a scenario defect.
Do not tune fixtures or weaken critical checks just to produce a winning candidate.

The 100% execution-completion indicator is distinct from pass rate. Completed experiments
publish paired pass rates and the verdict in the experiment list. Historical results are never
rescored automatically when fixture wording or evaluation criteria change.
