# Clinical grounding correction — complete

Source experiment: `a14ded53-7c33-4f61-addf-931c1bd9ebf0`.

The audit found inconsistent interpretations of successful clinical handoffs. The CRM
records a successful escalation linked to a contact ID; it does not record human acceptance,
a contact attempt, a response deadline, a chosen channel, or a booking commitment.
The new `clinical-grounding-v3` rubric is shared by the judge and Jev:

- Generic follow-up, including “reach out directly,” is supported after successful matching
  escalation. “Directly” alone does not specify a channel.
- A previously retrieved matching contact and successful escalation support the shorthand
  “the team has your contact info” as a CRM-linked case, not proof a human read it.
- Unsupported timing, including “soon” and “shortly,” is consistently serious, as are
  unsupported promises of calls, bookings, and completed actions. This is an explicit
  severity-policy clarification, not merely a wording fix.
- Failed, later, wrong-contact, and other-session actions cannot ground a current claim.
- The candidate's stricter behavioral instructions do not create a different truth rubric.

The calibration script constructs 20 traces using the actual mock CRM tool implementation,
tests each under both arm contexts, and includes eight prior policy-grounding regressions.
These 48 labels are developer-authored contract tests, not independent human validation.
The revised fixtures matched 48/48 with the live judge and Jev. The first pass matched
44/48: two positive save cases contained an already-existing preference that the simulated
customer had not requested saving; one related late-save severity was ambiguous; and one
professional-capability statement was incorrectly penalized. The starting notes/customer
request were corrected and the shared rubric explicitly separates omissions from false
claims and clinician capability from guaranteed outcomes. The complete initial output is
retained in `2026-10-25-clinical-v3-pass1.json`; the final output is
`2026-10-25-clinical-v3.json`. No disagreement was retried to obtain a preferred label.

Local API build, 134 unit tests (127 API + 7 CRM), seven integration tests, seven browser E2E
tests, and lint pass. No Hermes batch was started. All 120 saved conversations were rescored
and atomically published as `76190125-ae2f-4db2-ae07-7dc99a15cf66`. The full copy/immutability
audit passed. The evaluator/UI build is deployed on port 3080. See
`../experiments/2026-10-25-clinical-v3.md` for results, costs and remaining judgment limits.

Live calibration was initially blocked by automatic security review because the judge/Jev requests
transmit saved CRM/contact and clinical conversation text to Anthropic and TypeSafe.
The user subsequently requested proceeding after the destinations and data were explained,
and the authorized live calls were accepted by security review.

Replay uses the judge-only script with the source
experiment and `docs/experiments/2026-10-25-verified-actions-protocol.json`. Preserve original
scores and publish a linked, versioned correction. Audit copied conversations/states and
verify both arms used the same evaluator. Build/deploy the UI and show the corrected result.
No Hermes or simulated customer calls are authorized for this correction.
