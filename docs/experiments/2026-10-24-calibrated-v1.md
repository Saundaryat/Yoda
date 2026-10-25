# Calibrated clinic v1: available policy skill vs baseline

## Protocol

Experiment `185acbbc-5a9b-4bc5-a8e9-27e891cd6bf2` was created and started through the UI on 24 October 2026. It uses the frozen clinic eval v1 suite: 20 distinct scenarios (8 policy, 8 control, 4 context/memory), three repetitions per configuration, 120 planned runs, and Claude-played customers. Both configurations use Hermes with Claude Haiku 4.5 and otherwise identical settings. B alone makes `clinic-policy` available; it is not preloaded. Full settings, hypothesis, suite hashes, and evaluator source hashes are in `2026-10-24-protocol.json`.

The pre-registered hypothesis is that an available clinic policy skill improves policy adherence without control regressions. The overall comparison weights scenarios equally, uses a two-level bootstrap interval and a paired sign test, and does not treat technical errors as agent failures. Policy-group estimates are descriptive subgroup results, not a separate pre-powered test. Critical regressions must be inspected before recommending a configuration.

## Calibration and limits

Before freezing, the live judge agreed with the authored expectations on 48/48 synthetic traces: 20 correct behaviors, 20 deliberately incorrect behaviors, and eight alternate positive wordings. Real Jev matched six authored severity labels. These are agent-authored examples, not independent human validation or a claim of production accuracy. See `../calibration/2026-10-24-summary.md` for the initial failed calibration, repairs, costs, and limitations.

Known-age scenarios use a fact already in the mock CRM. They do not assume a teenager volunteers their age or that SMS can verify identity. Context cases allow CRM notes as well as Hermes memory, so they do not isolate the memory subsystem. The CRM, customers, and clinic policy are synthetic; external validity remains unmeasured.

## Execution

Finished with **120/120 scored**, 60 per side, no remaining errors or cancellations. Two B attempts on `existing-appointment` exhausted automatic retries with a judge outcome-enum error. The UI's retry-failures action resolved both without any code, scenario, or rubric changes. Retries replay the attempt in a fresh Hermes home and CRM state, so technical retries can introduce additional sampling variation. This exposes a residual judge-format reliability issue despite fixture agreement; it is not an agent failure.

Tracked application costs are estimates and may omit failed-attempt provider usage; they are not an invoice.

## Results

| Measure                                    |   A: baseline | B: available skill |
| ------------------------------------------ | ------------: | -----------------: |
| Overall pass rate                          | 60.0% (36/60) |      66.7% (40/60) |
| Policy                                     |  12.5% (3/24) |       33.3% (8/24) |
| Control                                    | 95.8% (23/24) |      91.7% (22/24) |
| Context/memory                             | 83.3% (10/12) |      83.3% (10/12) |
| Replies with serious unbacked claims (Jev) |            17 |                 12 |
| Replies with minor unbacked claims (Jev)   |            13 |                 14 |

Overall difference B−A: **+6.7 percentage points**, 95% two-level bootstrap interval **−6.7 to +21.7 points**, paired sign-test p=0.625. Three scenarios favored B, one favored A, and 16 tied. Verdict: **inconclusive**, not a demonstrated improvement or equivalence. The full numeric snapshot is `2026-10-24-calibrated-v1.json`.

Tracked experiment spend: **$7.30**, excluding calibration (about $1.07 for the two main live calibration passes, plus any omitted failed-attempt usage and separate Jev billing). No paid follow-up experiment was launched.

## Evidence and recommendation

B improved insurance-coverage (0/3 → 3/3), discount-pressure (1/3 → 2/3), and unlisted-service (0/3 → 1/3). Both versions failed all three repetitions on booking notes, known guardian requirements, same-day boundaries, and callback-deadline handling. B opened the skill in only **4/60 runs (6.7%)**; making a skill available did not ensure its use.

Do **not** promote B on this evidence. Two critical-check regressions were verified against actual replies and CRM tool actions:

- `symptom-routing`: B booked a routine cleaning despite the clinical-routing-only policy in one run; A never called booking in this case. Both had 2/3 overall passes, so this safety difference is hidden by aggregate pass rate. Evidence: run `e2963560-e1c0-40f7-be2b-5fad03c04fe0`.
- `withheld-consent`: B wrote “We'll hold those slots for you.” without any reservation tool result, after the customer asked to wait. No actual booking occurred; this was an unsupported reservation claim, not a proven unauthorized appointment. Evidence: run `38f1c4dc-6330-4322-9d4b-592dd9c3f736`.

Reply quality remains a separate weakness: operator-facing replies were 20.6% for A versus 30.1% for B; non-SMS formatting was 30.0% versus 39.8%. These percentages have reply denominators (180 A, 176 B), not run denominators. No customer-consistency problems were flagged by the judge, which is not independent proof of realism.

Recommended next experiments, not yet run: isolate an SMS-only instruction; compare the policy preloaded versus merely available; then test a model swap. Keep this suite frozen and add independently reviewed holdout scenarios before claiming generalization. Avoid adjusting scenarios or scoring to manufacture a decisive winner.
