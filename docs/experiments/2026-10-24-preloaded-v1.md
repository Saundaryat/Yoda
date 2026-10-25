# Clinic policy: available versus preloaded

**Superseded scoring:** both arms have now been rejudged from saved conversations under
`policy-grounding-v2`, with no new Hermes/customer calls. See `2026-10-24-policy-v2.md` and
corrected experiment `3de6b1b6-34f1-46fa-aff0-ce69302484ce`. Original numbers below remain intact.

## Protocol

Experiment `22793363-85f1-4d43-9cea-0a6df56956b2` was created and started through the UI on 24 October 2026. A is configuration `cc58d4e7-11a7-4770-bbb4-ec9489292332` (policy available), B is `75d90f45-fefa-49f4-bb35-236b2dd4df19` (policy preloaded). The saved specifications differ only in `skillMode`. Preloading uses Hermes's `-s clinic-policy` on each turn; the available mode exposes the skills tool so Hermes decides whether to open it. This mode change intentionally changes policy delivery, not the policy text.

Same frozen clinic eval v1 tasks, same 20 task versions, three repetitions per side, 120 planned real Hermes conversations, Claude-played customers. Same Haiku 4.5, instructions, CRM, memory settings, Sonnet judge, and Jev severity classification. Evaluator source hashes were checked against the frozen manifest before launch. Full settings and preregistered hypothesis are in `2026-10-24-preloaded-protocol.json`.

Primary comparison: overall equal-scenario-weighted pass rate with the existing two-level bootstrap interval and paired sign test. Policy/control/context subgroup results are descriptive. Safety and critical-check regressions are reviewed separately before recommending a version. Reply audience and SMS format remain separate from pass/fail.

This follow-up was motivated by the previous experiment's low skill-opening rate, so the same suite is now development evidence, not an untouched independent holdout. No scenario or scoring changes were made to increase the measured difference. Calibration agreement on authored synthetic traces is not independent human validation.

## Execution and results

Finished: **120/120 scored**, 60 per side, no remaining errors or cancellations. One B existing-appointment attempt exhausted automatic retries on the judge outcome enum; a UI retry resolved it without code or rubric changes. Tracked spend: **$7.16**. Tracked costs are estimates and can omit failed-attempt usage or separate classifier billing. The raw numeric snapshot is `2026-10-24-preloaded-v1.json`.

| Raw scored measure | A: available | B: preloaded |
| --- | ---: | ---: |
| Overall passes | 40/60 (66.7%) | 43/60 (71.7%) |
| Policy | 7/24 (29.2%) | 14/24 (58.3%) |
| Control | 21/24 (87.5%) | 21/24 (87.5%) |
| Context/memory | 12/12 (100%) | 8/12 (66.7%) |

Raw overall difference +5.0 percentage points; 95% bootstrap interval −13.3 to +23.3 points; paired sign-test p=0.7266. Five scenarios favored B, three favored A, 12 tied. The UI reports **inconclusive**. Because of the evaluator validity issue below, these raw score estimates are retained for audit, not endorsed as an unbiased treatment-effect estimate. The policy subgroup interval is descriptive and does not fix the validity issue.

Observed policy gains include booking-note passes 1/3 → 3/3, known guardian requirement 0/3 → 3/3, insurance 2/3 → 3/3, and clinical routing 2/3 → 3/3. B correctly refused same-day bookings in all three attempts but received false grounding failures. This was checked in all three transcripts, not inferred from the aggregate.

Genuine B failures remain: service recall 3/3 → 0/3; one contact-isolation reply quoted $140 instead of the tool's $120; one recovery failed to explain the lost slot; and one waiting customer received an unsupported promise to hold slots. Preloading is not sufficient to promote the configuration.

Reply-quality labels improved descriptively: operator-facing replies 43.2% → 23.7%; non-SMS style 42.6% → 20.8%, with reply denominators 176 A and 173 B. Available A opened the skill in 6/60 runs. B has no skill-view calls because the policy is preloaded, so zero opens is expected. Raw Jev counts were serious 13/16 and minor 10/14 for A/B, but these inherit upstream grounding false positives and must not be interpreted as a reliable severity comparison.

## Evaluator validity issue discovered during review

The frozen grounding rubric requires tool support for every factual claim but does not give the judge the agent's preloaded policy as an authoritative source. This creates a treatment-dependent false failure: in B run `347418b6-5336-420c-8101-bbed7b307790`, Hermes correctly said “Sorry, we can't do same-day bookings.” The judge rejected that sentence because no tool result stated the rule, despite that exact rule being in the preloaded clinic policy. The agent correctly refused today's slot and booked tomorrow.

This is an evaluator error, not an unsupported policy invention. Raw scores and their statistical interval must not be treated as an unbiased estimate of preloading's effect. No code, rubric, or task was changed mid-experiment. The original result is retained for audit. A corrected judge must receive an explicit authoritative-context channel (preloaded policy; available policy only when actually opened) and be calibrated on this distinction, then applied consistently to both arms under a new evaluator version. Changing just B's score or silently removing this case would bias the comparison.

Confirmed false-failure runs: `347418b6-5336-420c-8101-bbed7b307790`, `0ba7760d-5cb3-4e35-bbfd-b3295016dd69`, and `9f7e027f-6a3a-4433-aec3-20828b620d00`. All failed only `reply-grounded`, for correctly quoting the no-same-day rule. This was not represented in the initial calibration fixtures and limits that calibration's coverage. Available-arm runs that quote a policy without opening the skill also need an evidence audit; do not assume all grounding flags are valid.

Next step: fix and calibrate authoritative policy grounding, then rescore the retained conversations in both arms under a separate evaluator version while preserving original scores. Do not pay for another Hermes batch merely to repair judge context. Independently reviewed holdouts are still needed before claiming generalization.
