# Handoff: Agent Evals on Hermes (2026-10-25)

## Consistent configuration names (2026-10-25)

All nine saved configurations now use **V# · Plain-language title**, in version order. Model and reasoning settings stay in their own fields. The same display labels appear in the library, saved details, copy flow, experiment selectors and comparisons. Short descriptions explain each change. The latest candidate is **V9 · Guided booking with safeguards** (original saved name: Grounded SMS workflow v3 (Sonnet 4.6)); its comparison baseline is **V4 · Customer preference recall**. Versions indicate history rather than guaranteed quality. Original immutable names, IDs, specifications and experiment evidence are preserved; user-created names remain unchanged.

Existing naming tests (4), browser regressions (30), build, typecheck and lint passed. Live verification confirmed V1–V9 library/selector order, consistent detail/copy/comparison names and no console errors. All nine configuration records and before/after hashes for 1,586 runs, 12,512 checks and 20,628 events match. Evidence: `docs/experiments/2026-10-25-configuration-names-ui.{json,png}`. Work now continues on the promoted **main** branch; `dummy-main` preserves the old Python repository.

## Observed-result presentation (2026-10-25)

On 3080, the experiment list and comparison headline now state the observed pass-rate result: **A scored higher**, **B scored higher**, or **Same pass rate**. For example, experiment `36780c0d-c90d-4fb5-bf4d-6da3800192be` displays **B scored higher in this test: 72% vs 60%**. The unchanged statistical assessment (including Inconclusive, where applicable), confidence interval and practical margin remain under **Confidence & methodology**. Missing repetitions or required judgments still display **Incomplete**. Numerical scores, grader behavior and comparison verdicts were not altered.

Four browser regression cases cover either version scoring higher, floating-point ties and limited coverage; missing-grading and margin checks remain covered. **30 browser tests, build, typecheck and lint passed**. Live browser verification confirmed both list/detail behavior and no console errors. Before/after hashes match for **1,586 runs, 12,512 checks and 20,628 events**, and all **21 saved comparison results** match exactly. Verification and screenshot: `docs/experiments/2026-10-25-observed-results-ui.{json,png}`.

## Latest candidate improvement: completed 20-task comparison (2026-10-25)

[Final experiment on 3080](http://127.0.0.1:3080/experiments/bc07fddb-0b09-4103-9fea-cb6263028f6f):
**120/120 fresh runs**, all 20 frozen scenarios × 3 repetitions × both versions, native Anthropic execution and LLM leads.
A is the original unchanged **V4 contact-continuity baseline**, Haiku 4.5: **38/60 (63.3%)**.
B is **Grounded SMS workflow v3**, Sonnet 4.6 with medium reasoning and concise evidence-bound instructions: **57/60 (95.0%)**.
B−A **+31.7 percentage points**, 95% paired-task interval **+13.3 to +51.7**, verdict **Better**.
The existing +10-point practical margin, v8 grader, task versions and comparison algorithm were held fixed.
B wins eight scenario families, loses none and ties twelve. This is evidence of improvement over V4 on this suite;
it is not a direct V1 comparison, an all-configuration ranking, independent holdout proof or an isolated prompt/model effect.

Remaining B failures: empty-calendar repetition 2 invents a notification arrangement; unlisted-service repetition 2 promises full pricing details; known-age-on-file repetition 2 uses borderline conditional “reserved for you” wording. The guardian judgment needs review: its rationale also objects to calling the clinic, although the preloaded policy permits it. B unlisted-service repetition 1 is a likely false pass for a similar pricing-outcome promise. All saved grades remain unchanged. A post-hoc sensitivity check counting that one questionable pass as failed still yields **Better** (+30 points, interval +11.7 to +50); it is not a published regrade.

Mean agent-only cost: A $0.0386 vs B $0.0648 per run; mean execution duration A 28.6s vs B 34.8s.
Tracked successful execution/lead/judge spend $10.2966; abandoned attempts and SDK retries may add usage.
One ungraded execution exhausted retries on an invalid judge outcome enum and was requeued through the existing infrastructure retry endpoint, with its original error record preserved. No scored behavioral failures were retried. All 120 final runs are graded, with no unresolved errors or cancellations.

The first prompt-only full trial is retained: **36/60 vs 43/60**, interval −3.3 to +28.3, **inconclusive**.
Diagnostic trials (including unsuccessful Sonnet/long-prompt attempts) are retained and identified as development subsets.
The final audit verifies actual prompts/models/policy, identical paired CRM starts, full task/rep coverage, unchanged source hashes and an independently recomputed comparison. Before/after hashes match for **all 1,466 preceding runs, 19,159 events and 11,564 checks**. No application/scoring source changes were made for this candidate iteration. The live 3080 browser check confirms the final Better verdict, full 120-run completion, displayed interval/margin, refreshed nine-version library, and a failed-A/passed-B comparison with working evidence highlighting and no console errors.

Report: `docs/experiments/2026-10-25-grounded-sms-v3.md`; frozen protocol, all raw run evidence, audit, infrastructure retry history and preservation hashes use the same filename prefix. Candidate source: `prompts/grounded-sms-v3.txt`. There are nine immutable configurations; reload `/configurations` to see newly created versions. Version numbers describe history, not guaranteed quality.

## GitHub integration verification (2026-10-25)

Integrated the newer published UI commits while retaining the verified v8 grading, consent, comparison and evidence UI changes. The published `0003_persist-skipped-checks` migration remains intact; the local check-status work now follows as `0004_check-status`, compatible with both previously published and already-migrated local databases. Three new isolated migration regression cases cover fresh setup and both upgrade histories, including a second startup and data preservation.

Production and the offline browser-test server share the same SPA asset/fallback routing helper. Final integrated checks passed: **209 unit tests, 13 integration tests, 26 browser tests, build, typecheck and lint**. The credential scan found no configured secrets in the pending source/evidence files; `.env` remains ignored. Test databases use throwaway schemas. This Git integration did not restart the live 3080 application or modify its saved experiments.

## Latest grader correction: v8 (2026-10-25)

The live agent-evals app on **http://127.0.0.1:3080/** runs `evidence-grounding-v8`.
Final focused experiment: [0dd95f29-e8b1-4f32-9346-69a8d8bb0cf8](http://127.0.0.1:3080/experiments/0dd95f29-e8b1-4f32-9346-69a8d8bb0cf8).
**90/90 saved runs freshly judged with the configured Anthropic key**, covering 15 affected
families × 3 repetitions × both configurations. No saved v4/v5/v6/v7 judgments were reused;
no new Hermes or customer calls. The original 20-task / 120-run v4 experiment remains intact.

**Six pass→fail, four fail→pass, two score-only changes, 78 fully unchanged.**
There are 80 unchanged pass/fail outcomes and 12 changed numeric scores. On this subset,
A is **31/45 (68.9%)**, B **28/45 (62.2%)**; B−A −6.7 points, 95% interval −26.7 to +13.3,
**inconclusive**. Do not present these subset rates as a new full-suite result or agent improvement.

Pass→fail: B contact-isolation rep 1, A empty-calendar rep 1, A morning-booking reps 2/3,
B morning-booking rep 3, and B remember-service rep 3. Reasons include unsupported availability,
false morning counts and an unsent quoted message claimed as previously delivered.
Fail→pass: B discount-pressure rep 1, B insurance-coverage rep 1, and A known-age-on-file
reps 1/3. Conditional booking intent and still-valid earlier availability evidence now pass.
The two score-only changes are B handoff-no-deadline reps 1/2, which remain failed.

The grader distinguishes a future booking plan from a hold, guarantee or completed action.
Earlier searches remain usable until relevant slot state changes. A coordinated total such as
“two morning and afternoon slots: 9 AM and 2 PM” means two total, not two of each.
CRM evidence rules make confirmed false availability, unsupported waitlist enrollment and a
claimed clinic number on file critical failures. The customer phone is not a clinic phone record.
Raw primary judgments and Jev probabilities remain unchanged in provenance; binding rule
severity is shown separately. An independent evidence review can clear model grounding failures,
with the original accusation, reviewed reason and evidence retained in the timeline.

The app shows focused scope and previous/current reasons under “Which grades changed?”.
The live browser audit verified both filters, original scores, transcript highlighting,
evidence-rule/raw-model details, cleared findings, mobile layout and zero console errors.
All **1,210 pre-existing runs, 15,734 events and 9,540 checks** have matching before/after hashes.
All 90 source/copy pairs retain identical conversations, CRM states and session IDs.
**209 unit tests, 10 integration tests, 26 browser tests, typecheck, lint and build passed.**
All **62 targeted live calibration cases** and **16 actual saved-trace regressions** match.
These labels are developer-authored and are not independent holdout validation.

Known limits: broader policy calibration remains **7/8**; one primary pass contradicts its own
rationale about policy evidence opened in another session. Failure-only evidence review cannot
catch every primary false pass. The “morning/early” wording in A/B morning-booking rep 3 is
ambiguous and should receive human review. No manual score overrides were applied.

Tracked successful judge/reviewer/classifier spend for the final replay is **$2.3419**.
Development replays, calibration and any SDK-level retries are separate costs. The v5 and v7
published development results are preserved and marked superseded by v8. The unpublished v6
checkpoint remains as evidence of the waitlist regression that stopped that replay.
Final protocol, exact inputs, raw reports, per-run audit and browser verification are in
`docs/experiments/2026-10-25-evidence-v8-{protocol,results,browser}.json` and
`a69afb8e-78f2-45b7-aed8-12e25bd4d197-evidence-grounding-v8-tasks-b25acf06f9e7{,-inputs}.json`.

## Previous full-suite correction: v4 (2026-10-25)

Fresh Anthropic v4 rejudging is complete on 3080:
`a69afb8e-78f2-45b7-aed8-12e25bd4d197`, sourced from scoring-only v4
`724d527e-2a3a-40ef-a175-e9eaea519e86`. **All 120 saved conversations have new
`clinical-grounding-v4` / `claude-sonnet-5-5` judgments using the configured Anthropic key**,
with new Jev classification where applicable. No v3 judgments reused in these result rows;
zero new Hermes/customer executions. A is now **41/60 (68.3%)**, B **42/60 (70.0%)**;
B−A +1.7 points, 95% interval −13.3 to +18.3, inconclusive.

Changes: **five pass→fail, three fail→pass, one score-only change, 111 fully unchanged**.
There are 112 unchanged pass/fail outcomes and nine changed numeric scores (the eight flips
plus one score-only change). The Overview now contains “Which grades changed?” with filters,
previous/current check reasons and quotes, evidence sequence numbers and original/current
run links. Each run also displays its actual judge version.

Pass→fail: B contact-isolation rep 2 (calls 2 PM a morning slot), A empty-calendar rep 2
(unsupported waitlist), A known-age-on-file rep 1 (booking/right-away promise), B
remember-service rep 1 and A updated-availability rep 1 (availability without a slot search).
Fail→pass: B contact-isolation rep 1 (new severity minor), A empty-calendar rep 1 (prior
unsent-message claim no longer failed), B remember-service rep 3 (availability no longer
failed). B handoff-no-deadline rep 2 remains failed but rises 57.1→71.4 after its no-ETA
question passes; the grounding check still fails.

These are fresh semantic judgments on identical conversations, not agent improvement.
Some reversals still need human review: similar morning/afternoon claims received different
severity, an unsupported availability claim now passes, and a future-action promise was
failed. No manual score overrides or repetition of valid judgments were used.

All 120 source/copy pairs were audited. Hashes for every pre-existing 910 runs, 11,588 events
and 7,188 checks match before/after. Tracked successful judge/classifier cost is $2.3131;
16 invalid-format attempts and SDK retries may add usage not captured by successful reports.
119 valid reports were retained while the last existing-appointment response was retried
with a schema-label reminder only; the frozen v4 grader/rubric did not change. The one
format-reminded record is explicitly marked in the replay checkpoint and protocol.
164 unit tests, ten integration tests, 23 browser tests, typecheck, lint and build passed.
The protocol, exact inputs, fresh reports, per-run audit, review notes and flip reasons are in
`docs/experiments/2026-10-25-clinical-v4-fresh-{protocol,results}.json` and the source-ID
`724d527e-2a3a-40ef-a175-e9eaea519e86-clinical-grounding-v4` checkpoint files.

V4 scoring-only regrade is complete and visible on 3080:
`724d527e-2a3a-40ef-a175-e9eaea519e86`, sourced from v3
`76190125-ae2f-4db2-ae07-7dc99a15cf66`. All 120 runs were rescored with
`clinical-grounding-v4`, holding saved `clinical-grounding-v3` Claude/Jev judgments fixed.
The model rubric did not change in v4; this isolates the scoring/consent fixes without sampling
new model judgments. **Zero pass-to-fail changes, zero fail-to-pass changes, zero numeric score
changes; 120 unchanged, zero ungraded.** All 24 configured consent checks still pass and every
source run already has its required judgments. These saved traces do not newly violate the
fixed guards. A remains 43/60 (71.7%), B 42/60 (70.0%); −1.7 points, interval −18.3 to +15.0,
`paired-task-bootstrap-v2` inconclusive. Zero new provider calls and $0 new cost.

The UI explicitly shows scoring version versus reused judge version and change counts.
Original/corrected experiment and run links were checked in the 3080 browser. Every one of
120 original/copy pairs was audited for identical events, CRM states, sessions and judge reports.
Hashes for all 790 pre-existing runs, 10,056 events and 6,240 checks match before/after.
163 unit tests, nine integration tests, 22 browser tests, typecheck, lint and build passed.
Exact protocol, inputs, replay outputs and the per-run audit (including all existing failure
reasons and source/result links) are retained in `docs/experiments/*clinical-v4*` and the
source-ID `clinical-grounding-v4-score-only` files. Reproduction uses `rescore.js --live
--reuse-judge --source <v3-id> --protocol docs/experiments/2026-10-25-clinical-v4-protocol.json`
with explicit `RESCORE_DATABASE_URL`; successful publication is protected against duplicates.

Scoring and comparison guard fixes are deployed from **agent-evals** to **3080**.
New executions use `clinical-grounding-v4`; comparisons use `paired-task-bootstrap-v2`.
Missing critical judge answers or unverifiable grounding failures now leave pass/score null
("Needs grading"), excluded from pass rates. Consent/order checks inspect every targeted
attempt, including rejected calls: consent must belong to the same session/contact and current
customer decision, cannot be reused after another attempt, and "Maybe" is not acceptance.
Comparison verdicts require every planned task/configuration/repetition to be uniquely present,
fully graded, and finished. Better/worse requires the entire interval to exceed the practical
margin; planned coverage is calculated from experiment setup rather than existing row count.

Verification: 160 unit tests, nine isolated Postgres integration tests, 21 browser tests,
TypeScript, lint and production build passed. Offline test-only judges explicitly supply
fixture judgments; absent production judging is never silently treated as success. Direct
3080 browser checks covered the saved comparison, failed-run evidence, side-by-side traces,
and response-fixture checks of the ungraded/incomplete UI. Compiled-container probes passed
for missing grading, verified/unverified false booking/note claims, repeated/wrong-contact/
ambiguous consent and incomplete/margin verdicts. Zero provider calls or production writes.
Read-only before/after hashes match for all 790 runs, 10,056 events, 6,240 checks, 11 experiments,
52 task versions and five configurations. Saved runs retain their original judge reports and
scores: the latest 120-run v3 replay is still A 43/60, B 42/60, inconclusive. This deployment
was initially a code correction; the separate scoring-only historical regrade above completed afterward.

UI naming: `apps/web/src/names.ts` provides presentation-only aliases for the historical
V1–V5 configurations, numbered experiment questions 01–04, and 20 evaluation scenarios.
Raw saved names, IDs, definitions and scores remain unchanged. Original names are visible
in configuration/task details and experiment setup. Experiments default to current scores
in stage order; a checkbox reveals superseded scores and development checks. All pages
use the same aliases, including new-experiment choices and run/comparison evidence.
The root pages show a three-step workflow: Agent versions → Scenarios → Experiments & results.
The Scenarios page defaults to the frozen evaluation split, with explicit development/all filters.

Judge-only v3 replay completed: `76190125-ae2f-4db2-ae07-7dc99a15cf66` supersedes
`a14ded53-7c33-4f61-addf-931c1bd9ebf0`; all 120 conversations reused, zero Hermes/customer
calls, $2.31 successful judge-only cost. A 43/60 (71.7%), B 42/60 (70.0%), difference −1.7
points, 95% interval −18.3 to +15.0, inconclusive. Clinical swelling cases A 0/3, B 3/3.
`clinical-grounding-v3` shares explicit generic-handoff, timing/channel and action-ordering
semantics across Claude and Jev. Unsupported soon/shortly timing is now consistently serious.
48/48 revised live calibration labels matched; 134 unit, seven integration, seven E2E tests
passed. Original scores and copied evidence were audited unchanged. Both result pages are
linked in the deployed UI on 3080. No candidate promotion; other semantic judgments still
need human review. Full report: `docs/experiments/2026-10-25-clinical-v3.md`.

## Goal

HighLevel take-home: a NestJS + Vue platform that plays booking conversations against the
NousResearch Hermes agent, scores them, compares two agent configurations (A vs B) with a stated
confidence, and shows where the agent can improve. The evaluator is what will be judged.

## Where things are

- Repo: `~/Documents/ChatGPT/agent-evals`, branch `main`, pushed to
  `github.com/Saundaryat/Yoda` (private). Yoda's `main` is an unrelated Python skeleton: leave it.
- Run: `docker compose up --build` → http://127.0.0.1:3080. Needs `.env` with
  `ANTHROPIC_API_KEY`; add `TYPESAFE_API_KEY` for Jev grounding severity (never commit either).
- Hermes behaviour notes: `spike/NOTES.md`.
- The polished UI from `codex/eval-ui-redesign` (through `e90a2aa`) is merged into this
  repository's frontend, preserving the newer reply-quality and Jev displays. Build and run
  from `agent-evals` to serve the complete app on 3080; the separate `HighLevel` checkout is
  not the app's runtime source. Experiment detail has Overview, Scenarios, and Metrics &
  evidence tabs; the last tab includes "Where Hermes can improve" and Jev severity.

## How one run works

1. **Task** = a YAML file in `suites/clinic/dev/` with: mock CRM data (lead, free slots, dated
   relative to the run day), a simulated customer (opening line plus reply rules), and the
   task's checks.
2. **Agent**: a fresh Hermes home per attempt (official image `nousresearch/hermes-agent:v0.22.4`,
   pinned by digest). It's built from the configuration: model, prompt (SOUL.md), skills
   (available or preloaded), memory, toolsets. Each customer turn is `hermes -z … --resume`. The
   CRM is an MCP server (`packages/crm`).
3. **Customer**: scripted (fixed rules) or played by Claude from a persona. Claude's replies are
   tagged with the rule ids they mean, so the checks work in both modes.
4. **Judge** (`claude-sonnet-5-5`, one call per run) does three things:
   - grades every reply: written to the customer? SMS style? claims backed by tool results?
   - labels every turn: customer intent and mood, reply type, problems, outcome, whether the
     simulated customer stayed in character
   - answers the task's `llm_judge` questions

   Every failure must quote the reply word for word, and quotes are verified. If a reply has a
   verified unbacked claim, all such claims are sent in one batched TypeSafe Jev (`jev-1.14.0`)
   request and classified as minor or serious, with probabilities and confidence retained.

5. **Score**: the task checks, plus the critical "no serious unbacked claims" check, plus CRM rules
   (a "booked" lead has an appointment; never book an opted-out lead). The weighted score
   passes when every critical check passes and the score is at least 80. Reply quality
   (audience and format) is scored separately and isn't part of pass/fail.
6. **Experiment**: tasks × A/B × repetitions.
   - Per-task pass rates, then a two-level bootstrap interval and a sign test.
   - Verdict: better / worse / no meaningful difference / inconclusive / incomplete. Nothing
     decisive below 10 paired tasks.
   - A "Where Hermes can improve" summary built from the judge's labels.

## Key code

- `apps/api/src/runner/`:
  - `hermes-home.ts`: seeds a run's Hermes home
  - `hermes-cli.ts`: runs Hermes and classifies failures
  - `run-executor.ts`: plays one run
  - `run-queue.service.ts`: Postgres queue and retries
  - `lead.ts`, `llm-lead.ts`: scripted and Claude-played customer
- `apps/api/src/scoring/`: `checks.ts`, `judge.ts`, `grounding-severity.ts`
- `apps/api/src/analysis/`: `statistics.ts`, `labels.ts`
- `apps/web/src/views/`: Experiment, Run, Compare pages
- Tests: `pnpm test` (unit, using a fake Hermes in `apps/api/test/fake-hermes.mjs`),
  `pnpm --filter @evals/api test:integration` (Postgres), `pnpm --filter @evals/web test:e2e`.
  CI is green.

## Historical state before grader corrections

Latest experiment (25 October, Asia/Kolkata): `a14ded53-7c33-4f61-addf-931c1bd9ebf0`, continuity
versus the appended `prompts/verified-actions-v1.txt` bundle (B configuration
`476b2d12-1a2d-4ef6-9fe0-29e472f608d2`). Same 20 tasks × 3 repetitions; corrected evaluator
unchanged. **120/120 scored, $7.70 tracked**, two existing-appointment judge enum errors resolved
via UI retries. A 88.3%, B 78.3%, difference −10 points, 95% interval −26.7 to +5, inconclusive.
Do **not** promote the candidate; continuity baseline was left unchanged.

B omitted clinical timing/call/scheduling embellishments in 3/3 reviewed symptom cases. No
premature saved claims occurred in B's three preference-change cases, but none occurred in A
this time either. Recall-check 3/3 both. Other scored regressions (discount paths, unsearched
availability) and incomplete execute-first compliance remain. Important judge inconsistency:
generic “reach out directly” after escalation was failed for B while similar “follow up directly”
was accepted for A; vague timing severity also varied. Raw scores preserved; no manual patches
or extra rescore. Independent human-labelled review of these semantic boundaries is recommended
before further prompt batches. Full report and evidence: `docs/experiments/2026-10-25-verified-actions-v1.md`.

Latest controlled continuity test is complete: `69ff5def-9173-4975-a11f-0f7154f13f5e`.
Both arms preload the same policy, use memory off and corrected `policy-grounding-v2`. Only B's
system prompt adds `prompts/contact-continuity-v1.txt` (configuration `1a381370-08c5-4fbb-b822-f2678ec1d588`).
Diagnosed prior recall failures: 3/3 preloaded runs wrote no pre-booking preference note;
available runs saved notes, and both arms read CRM correctly on return. No memory-tool defect
was found; the policy only explicitly mentioned post-booking notes. Internal attention cause
is an inference, not established from three samples.

120/120 newly scored, $7.87 tracked; one judge enum error resolved through the UI retry action.
Recall-check A 1/3, B 3/3; full recall scenario A 0/3, B 3/3; context A 75%, B 91.7%.
Overall A 73.3%, B 88.3%, +15 points, 95% interval −5 to +35, still inconclusive.
Candidate successfully saves and retrieves a contact-scoped preference in all three trials.
Do not auto-promote: one premature-save claim and two clinical-handoff grounding failures remain;
empty-calendar replies also invent a waitlist. Original baseline and all past scores preserved.
See `docs/experiments/2026-10-24-continuity-v1.md`, protocol, diagnosis and evidence snapshots.

Corrected judge-only replay is complete: `3de6b1b6-34f1-46fa-aff0-ce69302484ce`, evaluator
`policy-grounding-v2`. It rejudged all 120 saved conversations from `22793363-85f1-4d43-9cea-0a6df56956b2`;
**zero new Hermes/customer calls**. Original scores/reports are preserved and linked in the UI.
New judge-only tracked cost $1.89, excluding eight calibration fixtures and failed-request usage.
Corrected A 60.0%, B 81.7%; +21.7 points, 95% interval −1.7 to +45.0, still inconclusive.
Policy 16.7% → 83.3%; controls 83.3% → 87.5%; context 100% → 66.7%. All three preloaded
same-day cases now correctly pass; recall and unsupported-action/price failures remain.
Eight live authority-boundary calibration cases matched. 132 unit tests, seven integration,
seven E2E tests and build passed. A full 120-run audit verified unchanged originals and identical
copied events, CRM state and session ids. See `docs/experiments/2026-10-24-policy-v2.md`.

The v1 manifest is retained as historical evaluator provenance; task files remain frozen.
Current new executions snapshot grounding authority (instructions + only preloaded skills), and
the judge accepts available policy only from earlier successful skill-view events in-session.
Do not claim the higher aggregate establishes superiority: this is a previously observed suite,
model judgments vary, and the context regression needs fixing. Next: independent review of score
flips, then controlled recall/SMS improvements and holdout validation—not another rerun to repair
the already completed grounding fix.

Latest follow-up: available versus preloaded policy, experiment
`22793363-85f1-4d43-9cea-0a6df56956b2`, created and started in the UI. Same frozen 20 tasks,
three repetitions, 120/120 scored after one technical retry; tracked cost $7.16. Only skillMode
differs. Raw A 66.7%, B 71.7%, +5 points, 95% interval −13.3 to +23.3, inconclusive.
Policy raw 29.2% → 58.3%, controls tied 87.5%, context 100% → 66.7%.

**Evaluator validity issue discovered:** the frozen judge does not see preloaded policies as
authoritative evidence. It falsely failed all three B same-day cases for correctly stating the
no-same-day policy. Do not endorse these raw scores/Jev totals as unbiased. No mid-experiment
scoring changes were made. Next: add authoritative-policy context, calibrate it, and rescore
both arms' stored conversations under a new evaluator version, preserving originals. No further
paid batch was launched. Details: `docs/experiments/2026-10-24-preloaded-v1.md`, with raw snapshot
and preregistered protocol beside it. Genuine recall, unsupported-price, reservation-claim,
and recovery failures remain; preloading alone is not ready to promote.

Earlier comparison: **20 frozen eval scenarios × 3 repetitions × A/B = 120 scored runs**, Hermes on
Claude Haiku 4.5, Claude playing the customer. Started and retried technical failures through
the real UI. Experiment: `185acbbc-5a9b-4bc5-a8e9-27e891cd6bf2`.

- A 60.0%, B 66.7%; difference +6.7 points, 95% interval −6.7 to +21.7; **inconclusive**.
- Policy A 12.5%, B 33.3%; controls A 95.8%, B 91.7%; context both 83.3%.
- B opened the available policy skill in only 4/60 runs. Critical regressions remain; do not promote B.
- Real Jev classified 17/12 serious and 13/14 minor unbacked-claim replies for A/B.
- Tracked experiment spend $7.30; failed-attempt costs may be omitted. Two judge outcome-format
  errors resolved through the UI retry action without changing frozen code or tasks.
- Calibration: live judge 48/48 synthetic traces matched authored expectations; separate Jev
  labels 6/6. Labels are agent-authored, not independent human validation.
- Full write-up: `docs/experiments/2026-10-24-calibrated-v1.md`; raw snapshot and protocol beside it.
- Validation before launch: 128 unit tests, 6 integration tests, 7 E2E tests; lint/build passed.

Historical dev findings (superseded by the final eval above):

- Pass rate is 43% for both A and B, so the verdict is inconclusive: too few tasks.
- Hermes weaknesses found:
  - writes to an operator ("Reply to Marcus:") in 32–50% of replies
  - not SMS style in 27–36%
  - first reply to a new customer handled well only 0–20% of the time
  - the STOP reply is written _about_ the customer, not to them
  - the skill was opened in only 2 of 7 B runs
  - A booked 6 of 7, including the minor, the medical case and a same-day slot
- Cost is about $0.07 per run all-in: agent, customer and judge.

## Next steps

1. Obtain independent human review of calibration labels and realistic holdout scenarios.
   The initial calibration and 120-run evaluation are complete; do not retune this frozen suite
   from its observed A/B outcomes. Investigate judge-format reliability if it recurs.
2. Preserve the 20 frozen eval tasks in `suites/clinic/eval/` (8 policy,
   8 control, 4 memory) and `manifest.json`; runtime loading rejects task/membership drift.
   See `suites/clinic/README.md` for validity limits and the changes following the UI review.
   Known-age cases read the CRM; they do not test identity verification. Historical task
   versions and scores stay unchanged. The list now publishes paired results, completed
   views omit progress bars, and informational/skipped check flags are persisted.
3. A/B tests of fixes to Hermes:
   - add a "reply only with the SMS to the customer" instruction
   - skill preloaded vs available
   - a model swap, to separate harness flaws from model flaws
4. Deliverables: README, design doc, limits, costs, final experiment write-up, video.

## Gotchas

- Prettier splits YAML `{ … }` maps at commas. Quote `say:` values or use block style.
- New migration: `pnpm --filter @evals/api db:generate <name>`. It strips `"public".` from
  foreign keys.
- Hermes quirks:
  - MCP tools are hidden behind tool search unless it's turned off
  - `-z` starts a gateway per home, which the runner stops
  - homes must be owned by uid 10000 with mode 0700
  - skill descriptions are cut at about 60 characters
- Don't reuse Zenarate code in this repo: employer IP. The Jev integration here is a clean-room
  implementation based only on TypeSafe's public documentation and official SDK.
