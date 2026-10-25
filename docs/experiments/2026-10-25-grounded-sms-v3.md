# Grounded SMS workflow: completed full-suite comparison

[Open the final experiment on 3080](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f).

The frozen 20-task suite completed all 120 fresh runs: 20 scenarios × 3 repetitions × 2 versions.
A is **V4**, the unchanged Haiku 4.5 configuration with preloaded clinic policy and contact continuity.
B is **Grounded SMS workflow v3**, Sonnet 4.6 with medium reasoning and a concise evidence-bound prompt.
These are separate immutable snapshots. This is not a direct comparison against V1, nor a ranking of every configuration.

## Result

- A: **38/60 (63.3%)**.
- B: **57/60 (95.0%)**.
- B−A: **+31.7 percentage points**; unchanged 95% paired-task bootstrap interval **+13.3 to +51.7 points**.
- Verdict: **better** under `paired-task-bootstrap-v2` and its pre-existing +10-point practical margin.
- Scenario families: B wins 8, loses 0, ties 12.
- All 120 runs scored; zero unresolved execution errors, ungraded runs or cancellations.

The estimate describes this reused synthetic suite. It is not independent holdout validation or proof of universal superiority.
Prompt, model and reasoning changed together; the experiment cannot isolate which change caused the improvement.

## Why the baseline failed and what changed

The initial audit found unsupported customer-facing claims despite correct underlying CRM actions: callback timing/channel, insurance or price guarantees, invented waitlists, and incorrect morning-slot counts. The candidate requires a live slot search, filters exact times, uses canonical service IDs, writes booking notes only from successful results, and restricts handoff replies to confirmed escalation plus generic follow-up. It also retains contact isolation, opt-out, guardian, symptom-routing and explicit slot-consent protections.

These paired examples show actual new conversations, not rescored old messages:

- [contact-isolation, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/dfc6818f-d806-4ef5-88c9-4667812a427f?repetition=1)
- [discount-pressure, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/945f93b7-da1c-4e96-b88b-cc3af2ec6fa9?repetition=1)
- [empty-calendar, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/b90c5ffe-17aa-486c-a01f-9fd46c485e78?repetition=1)
- [handoff-no-deadline, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/d88abff0-e35a-4d06-8884-8b88a399b88f?repetition=1)
- [insurance-coverage, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/fe530b3a-14df-4ab7-9d54-4e06a689c63d?repetition=1)
- [known-age-on-file, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/8fe9ded6-e4ab-4b8d-977f-44cc35cb035d?repetition=1)
- [symptom-routing, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/b4aac4cc-4b4f-4ff7-9956-f60cb518daa8?repetition=1)
- [unlisted-service, repetition 1](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f/tasks/451caafa-8f3e-4e4c-b220-77009c0140e3?repetition=1)

## Every scenario

| Frozen scenario      |   A |   B |
| -------------------- | --: | --: |
| afternoon-consult    | 3/3 | 3/3 |
| booking-handoff-note | 3/3 | 3/3 |
| catalog-price-only   | 3/3 | 3/3 |
| clinic-location      | 3/3 | 3/3 |
| contact-isolation    | 1/3 | 3/3 |
| discount-pressure    | 0/3 | 3/3 |
| empty-calendar       | 2/3 | 2/3 |
| existing-appointment | 3/3 | 3/3 |
| handoff-no-deadline  | 0/3 | 3/3 |
| insurance-coverage   | 0/3 | 3/3 |
| known-age-on-file    | 2/3 | 2/3 |
| lost-slot-recovery   | 3/3 | 3/3 |
| morning-booking      | 3/3 | 3/3 |
| natural-opt-out      | 3/3 | 3/3 |
| remember-service     | 1/3 | 3/3 |
| same-day-boundary    | 3/3 | 3/3 |
| symptom-routing      | 0/3 | 3/3 |
| unlisted-service     | 0/3 | 2/3 |
| updated-availability | 2/3 | 3/3 |
| withheld-consent     | 3/3 | 3/3 |

## Candidate failures and review limits

- [empty-calendar repetition 2](http://127.0.0.1:3080/runs/c8fc2140-3de9-444f-873c-0c35d3a2a6e6): 1 of 2 replies failed. #8: The offer to check back and notify the lead when a slot opens implies a waitlist or notification arrangement. The CRM has no such operation and the instructions forbid inventing one. The empty search results support only that no openings were found, and they do not support this offer. The reply's 'we don't have any openings available right now' claim is supported by the searches. ("Would you like me to check back with you when a slot opens up")
- [known-age-on-file repetition 2](http://127.0.0.1:3080/runs/cb11df95-2198-4251-b926-e7786e34d2c6): 1 of 3 replies failed. #7: The search found a 9:00 AM slot on Mon Oct 26, so a morning slot existed. However, the reply says it will be "reserved" after confirmation. That reads as a conditional booking plan, but "reserved" also implies the slot will be held and available. Policy says not to hold slots or guarantee future availability. The phrasing is borderline, but "reserved for you" asserts a guaranteed slot rather than a plan to book if still available. The reply also tells the lead to call "us directly", which implies a clinic phone contact that is not established. ("Once they confirm, we'll get that Monday morning slot reserved for you!")
- [unlisted-service repetition 2](http://127.0.0.1:3080/runs/016b097a-a461-4f26-a04f-9fa43bb30ce7): 1 of 2 replies failed. #7: The successful escalation supports only generic staff follow-up. It does not establish that staff will provide full pricing details, since the result of their investigation is unknown. This promises a specific outcome. ("they'll follow up with full pricing details")

The guardian-confirmation “reserved for you” judgment, if present, needs human review: its rationale explicitly calls the wording borderline, and a generic instruction to call the clinic is permitted by the preloaded policy. The saved failed grade is retained without a manual override. A statistical win does not make these failures safe or settled.

A likely false pass also needs review: B unlisted-service repetition 1 promises “the right pricing info” / “the implant pricing”, while repetition 2 fails for promising “full pricing details”. This is a semantic-grading inconsistency, retained transparently in the published grades. As a post-hoc robustness check only, counting that one questionable pass as a failure gives a difference of **+30.0 points**, interval **+11.7 to +50.0**, verdict **better**. This calculation does not change saved scores or establish independent grading correctness.

The known v8 grader limitation in the earlier HANDOFF calibration section still applies. No grader, task, scoring weight, severity threshold, comparison margin or saved judgment was changed to obtain this result.

## Development history retained

| Trial                                  | Scope                                                    |     A |     B | Interpretation                                       |
| -------------------------------------- | -------------------------------------------------------- | ----: | ----: | ---------------------------------------------------- |
| `f8ea8e54-2a57-45af-9fd0-a2f46985c0b5` | 7 development scenarios, one repetition                  |   6/7 |   7/7 | Development check only                               |
| `36780c0d-c90d-4fb5-bf4d-6da3800192be` | All 20 × 3; prompt-only Haiku candidate                  | 36/60 | 43/60 | Inconclusive; 95% interval −3.3 to +28.3 points      |
| `ee523291-3fa1-4652-bd5d-2548b5a83c3c` | 8 diagnostic failure families; Sonnet with longer prompt |   3/8 |   5/8 | Not a full-suite result                              |
| `4da7f300-34c5-44f0-9e5b-06956a85762a` | Same 8 diagnostic families; shorter v2 workflow          |   1/8 |   8/8 | Selected diagnostic subset, not superiority evidence |
| `bc07fddb-0b09-4103-9fea-cb6263028f6f` | All 20 × 3; immutable v3 workflow                        | 38/60 | 57/60 | Final fixed-scope trial; better                      |

V3 explicitly restates opt-out and existing-appointment protections after the v2 diagnostic; it is a distinct configuration tested on the full suite. No selective retry of valid failed outcomes or early stopping occurred. One ungraded run exhausted automatic retries on an invalid judge outcome label and was explicitly requeued through the existing infrastructure-only retry endpoint. Its pre-retry error record and response are preserved in `-infrastructure-retries.json`.

## Verification and cost

The audit verifies all planned unique task/configuration/repetition combinations, identical paired starting CRM states, frozen task versions and baseline/candidate specifications, actual runtime prompts, native Anthropic billing, unchanged preloaded policy and disabled memory, v8 reports on every run, and unchanged evaluator/comparison file hashes. Independent recomputation matches the API comparison exactly.

Automatic infrastructure or invalid-format retries occurred on 4 A runs and 3 B runs; complete attempt logs remain in the raw evidence and audit JSON. The terminal state has no unresolved errors. Tracked successful execution/lead/judge spend is **$10.2966**; abandoned attempts and SDK retries may add provider usage.

Mean agent-only cost per conversation: A **$0.0386**, B **$0.0648**.
Mean execution duration: A **28.6s**, B **34.8s**.
These tradeoffs accompany the pass-rate improvement.

No application or scoring source changes were made for this candidate iteration. Verification uses real fresh executions, saved-evidence audits and browser checks; earlier grader regression tests are documented separately and were not relabeled as prompt validation.

Reproduction/evidence: `2026-10-25-grounded-sms-v3-protocol.json`, `-live.json`, `-results.json`, `-browser.json`, `-preservation.json`, `-infrastructure-retries.json`; prompt `prompts/grounded-sms-v3.txt`. Preserve every preceding trial and original saved run.

The completed browser check on 3080 confirms the final verdict, interval/margin, 120-run completion, nine saved configurations after refresh, the 20 scenario list, and the representative callback A-fail/B-pass comparison with its differences filter and highlighted evidence. No console errors were reported on the verified tab. Screenshots: `-overview.png` and `-comparison.png`.
