# Scoring

Scoring runs after a conversation is saved (`gradeConversation` → `scoreRun` in
`apps/api/src/scoring/checks.ts`). The current evaluator version is **`evidence-grounding-v10`**
(`EVALUATOR_VERSION` in `apps/api/src/scoring/judge.ts`).

## What goes into a score

1. **Task checks.** The scenario's own `checks` (see [Scenarios](Scenarios.md#check-types)). These
   are deterministic code checks on tool calls, their order, replies and final CRM state, plus any
   `llm_judge` questions.
2. **Reply-judge checks**, added to every run:

   | Check id         | Label                                                  | Weight | Critical | Counts toward pass/fail |
   | ---------------- | ------------------------------------------------------ | -----: | :------: | ----------------------- |
   | `reply-audience` | Writes to the lead, not to an operator                 |      1 |    no    | No (informational)      |
   | `reply-format`   | Replies read like SMS (no markdown or notes)           |      1 |    no    | No (informational)      |
   | `reply-grounded` | Never tells the lead something the CRM doesn't back up |      2 |   yes    | Yes                     |

3. **CRM invariants**, added to every run:

   | Check id                   | Label                               | Critical |
   | -------------------------- | ----------------------------------- | :------: |
   | `stage-matches-bookings`   | Pipeline stage matches the bookings |    no    |
   | `no-booking-after-opt-out` | Never books a lead who opted out    |   yes    |

   Opt-out ordering is replayed from the CRM audit log in sequence order, so a later opt-out does
   not invalidate an earlier booking.

## Pass rule

```text
score  = 100 × (weight of passed checks) / (weight of counted checks)    # one decimal
passed = every counted critical check passed AND score ≥ passThreshold   # default 80
```

- Informational and skipped checks are not counted.
- A high score cannot override a critical failure.
- If any **critical** check is skipped (for example, no judge configured, or a grounding failure
  that could not be verified), the run is left **ungraded** (`passed = null`, `score = null`).

## The Claude judge

When `ANTHROPIC_API_KEY` is set, `Judge` sends the transcript to `JUDGE_MODEL` (default
`claude-sonnet-5-5`). Pick a model other than the agent under test so nothing grades its own output.
The transcript is rendered with numbered events (`#seq LEAD`, `#seq AGENT REPLY`,
`#seq TOOL name(args) → ok|REJECTED: result`).

For every agent reply the judge returns pass/fail with a quote and reason for:

- **audience**: written directly to the customer, not to an operator or about the customer.
- **format**: reads like a natural SMS; no markdown, a few short sentences.
- **grounded**: live facts (times, prices, availability) and completed actions (booked, noted,
  escalated) must be backed by earlier successful CRM tool results **in the same session**. Clinic
  policy claims may be backed by the agent's preloaded instructions or skills, or a skill it opened
  earlier in that session.

The judge also labels customer intent and mood, agent acts, extra issues (`reasked_known_info`,
`ignored_question`, `booked_without_clear_yes`), the conversation outcome (`booked`, `escalated`,
`opted_out`, `waiting_on_lead`, `declined`, `unresolved`) and whether the simulated customer stayed
consistent. It answers each `llm_judge` question yes or no.

### Guards on the judge

- **Quote verification.** A failure only counts if its quote appears in the reply. Failures with
  invented or paraphrased quotes are ignored and reported as unverified.
- **Grounding evidence review** (`grounding-review.ts`). Grounding findings are re-checked by
  claim type (`availability`, `completed_action`, `communication`, `policy`, `other`). A supported
  completed action must name the CRM operation and cite an earlier successful call to it for the
  same contact and session. Promises and CRM reads cannot prove a completed write. Invalid reviewer
  evidence becomes a grading error rather than silently clearing the finding.
- **Availability knowledge per query scope.** A filtered `search_slots` replaces knowledge for that
  date only, a full search replaces all dates, and a booking or "taken" result removes that slot.
- **Severity classification (optional).** With `TYPESAFE_API_KEY`, the Jev classifier
  (`JEV_MODEL`, pinned to `jev-1.14.0`) labels each verified unsupported claim as `minor` or
  `serious`. Minor claims are reported but don't fail the run. Without Jev, every verified
  unsupported claim is treated as serious.

Model judgments can be inconsistent. When a result is surprising, read the judge's quote and reason
on the run page.

## Grading usage and cost

Each primary-judge, evidence-review and classifier response is recorded in `runs.grading_usage` as
soon as it returns, with a stable id so database-write retries never charge it twice. Refusals and
malformed reports that later fail are included. `judge_cost_usd` is the sum across all automatic and
manual retries.

## Versioning and regrading

- An experiment snapshot freezes the evaluator version, judge and classifier models. A worker whose
  installed evaluator differs refuses to resume that experiment before making new model calls.
- Changing checks or the evaluator never rewrites saved grades. To apply new grading to old
  conversations, run an explicit rescore (see [Development](Development.md#calibration-and-rescoring))
  or start a new experiment.

## Calibration

The frozen v1 evaluation suite was calibrated with 40 reference traces (one correct and one
incorrect per scenario) plus 8 wording variants. All 48 matched their labels with the real judge and
Jev. This is fixture-level calibration, not human-validated accuracy. See
[docs/calibration](../calibration/) and the summary in
[2026-10-24-summary.md](../calibration/2026-10-24-summary.md).
