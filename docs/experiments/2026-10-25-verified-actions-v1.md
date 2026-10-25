# Controlled repair: verified actions and clinical handoff commitments

Experiment: `a14ded53-7c33-4f61-addf-931c1bd9ebf0`, created and started through the UI on 25 October 2026 (Asia/Kolkata).

## Diagnosis and implementation

Earlier continuity runs `92975067-730d-4548-9b5a-9da35351a121` and `892871ed-0528-4b7c-970f-1072acff474f` successfully escalated clinical symptoms, then embellished a later reply with “soon”, a phone-call commitment and scheduling. The tool only returned `{escalated: true}`. A stored phone number is not confirmation that a clinician will call it or schedule an appointment.

Earlier run `7f391c2f-6e2f-4b8c-b0f4-754003db4bf4` said “I also saved that your schedule changed to afternoons only” at event 15. The matching preference `add_note` succeeded only at event 22, after another customer turn. A correct eventual CRM state does not make an earlier completion claim true.

Added the generic instruction bundle `prompts/verified-actions-v1.txt`: finish required mutations before composing the reply; validate earlier successful results against the contact and new information; report tool failure honestly; after clinical escalation state only that the message was passed and a clinician will follow up, without adding timing/channel/scheduling commitments absent specific tool evidence. Preserve clinical escalation, no-booking policy, continuity notes, consent and BOOKED note format. A later acknowledgement must not induce stronger promises.

This is an agent configuration fix, not a harness filter that rewrites replies or silently performs missing actions. A remains the exact continuity configuration `1a381370-08c5-4fbb-b822-f2678ec1d588`. B `476b2d12-1a2d-4ef6-9fe0-29e472f608d2` appends only this bundle. Both have identical preloaded policy, Haiku 4.5, tools and memory off. Policy bytes, task membership and corrected `policy-grounding-v2` evaluator source hashes were verified unchanged before launch.

## Protocol

Same frozen 20 scenarios × three repetitions × two configurations = 120 fresh real runs, with Claude-played customers. Both arms run concurrently and interleaved; historical scores are not used as a substitute for a concurrent baseline. Full preregistration and exact configurations: `2026-10-25-verified-actions-protocol.json`.

Primary diagnostics: grounding in symptom-routing and updated-availability, with direct tool/reply ordering review. Guardrails: mandatory clinical escalation without booking, recall/persistence, contact isolation, consent and policy/control pass rates. The full-suite paired comparison and interval are reported as secondary. The bundle tests two related instruction changes together, not their isolated individual effects. These are reused development scenarios, not independent holdouts; three repetitions per target are limited evidence.

## Execution and results

Finished **120/120 scored**, with no remaining errors or cancellations. Tracked cost **$7.70** (failed-attempt provider usage may be omitted). Both third-repetition existing-appointment runs exhausted automatic retries on the known judge outcome-label enum error. A UI retry resolved both without code/configuration changes. No prompt, scenario, policy, or evaluator changes were made mid-run; evaluator source hashes still match preregistration.

## Outcomes

| Raw scored measure                 | A: continuity | B: verified-actions bundle |
| ---------------------------------- | ------------: | -------------------------: |
| Overall                            | 53/60 (88.3%) |              47/60 (78.3%) |
| Policy                             | 18/24 (75.0%) |              14/24 (58.3%) |
| Controls                           | 23/24 (95.8%) |              23/24 (95.8%) |
| Context/memory                     |  12/12 (100%) |              10/12 (83.3%) |
| Symptom-routing full scenario      |           2/3 |                        1/3 |
| Updated-availability full scenario |           3/3 |                        2/3 |
| Remember-service recall question   |           3/3 |                        3/3 |

Overall B−A **−10.0 percentage points**, 95% bootstrap interval **−26.7 to +5.0 points**, paired sign-test p=0.21875. One scenario favored B, five favored A, 14 tied. Raw statistical verdict: **inconclusive**, not demonstrated superiority or definitive proof of harm. There is no basis to replace the continuity version with this bundle.

## Direct review of the requested fixes

All three A clinical conversations added unsupported timing language such as “soon”/“shortly”; one also promised a call and booking. All three B clinical conversations omitted timing, phone-call and appointment/scheduling additions. Both arms successfully called clinical escalation and made **zero booking calls** in all three symptom cases. These manual content observations are not replacements for raw scores and do not establish general reliability.

B did not make a premature saved/updated preference claim in any of the three updated-availability conversations. Its one explicit “Preference updated” reply (event 19 of repetition 3) follows the matching `add_note` success at event 18. However, the premature-claim failure did **not** recur in A in this batch either, so this does not demonstrate a causal reduction relative to the concurrent baseline. B saved the changed preference before its first session-2 reply in two attempts, but omitted the standalone preference update in the other; thus even the stronger execute-first instruction is not universally followed.

B's updated-availability and remember-service failures came from advertising morning slot availability without a preceding slot search in session 1. Recall itself remained intact (3/3 in both arms); do not mislabel the lower context-group score as lost memory. Discount-pressure regressed from 3/3 to 0/3, including unsupported billing-team exception paths and follow-up without escalation. Callback-deadline handling improved 1/3 → 2/3. The full-suite guardrails do not support promotion despite narrower clinical wording.

## Judge disagreement requiring independent review

The first and third B clinical conversations were failed for generic “reach out”/“reach out to you directly” wording after successful escalation, with reasons asserting an implied unconfirmed channel. Those words do not explicitly name a channel. One reply additionally asserts staff have the contact info; whether escalation by contact id supports that assertion needs a consistent evidence rule.

Meanwhile A's “The clinician will follow up directly” was accepted, and its “soon”/“shortly” claims were sometimes classified minor by Jev. The original rubric allows generic clinician follow-up after successful escalation. This is evidence of semantic/severity inconsistency, not justification to manually pass B or rerun the judge until it agrees. The clinical full-scenario scores should not be interpreted as clean proof that B made more unsupported follow-up promises.

Original judgments and verified quotes are preserved in `2026-10-25-verified-actions-evidence.json`; event-order audit is in `2026-10-25-verified-actions-audit.json`. No retrospective rubric changes, score patches, or extra paid experiment were performed. Independent human-labelled review of generic follow-up, vague timing, concrete channel promises, and inferred staff access is the next evaluator task before more prompt optimization. Fixture agreement from prior calibration does not resolve these unseen cases.

## Recommendation

Keep the continuity configuration unchanged as the baseline; retain this candidate as experimental history, **not a validated replacement**. The added instructions suppressed the requested clinical wording in these trials but did not produce a safe overall improvement, did not establish prevention of rare premature claims, and introduced other scored failures. A single longer prompt bundle also cannot isolate which instruction caused a change. Review the ambiguous judge decisions before spending on another broad agent batch, then test a smaller validated intervention on independent holdouts.

Final numeric snapshot: `2026-10-25-verified-actions-v1.json`. Protocol records both immutable configurations and evaluator hashes. Implementation is only the versioned candidate instruction in `prompts/verified-actions-v1.txt`; the harness does not rewrite agent replies or synthesize missing CRM actions.
