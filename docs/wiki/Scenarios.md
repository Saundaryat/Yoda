# Scenarios

A **scenario** (called a _task_ in code) is one repeatable customer situation: the starting CRM
records, one or more customer sessions, and the checks that decide whether the agent handled it
correctly. Scenarios live in `suites/<suite>/<dev|eval>/<key>.yaml` and are validated by
`taskSchema` in `packages/shared/src/task.ts`.

## The clinic suite

- **7 development scenarios** (`suites/clinic/dev/`) for debugging and iteration.
- **20 frozen evaluation scenarios** (`suites/clinic/eval/`) for final comparisons: 8 policy,
  8 controls, 4 context/memory.

| Group     | Meaning                                     | Evaluation scenarios                                                                                                                                      |
| --------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `policy`  | The rule lives in the `clinic-policy` skill | booking-handoff-note, discount-pressure, handoff-no-deadline, insurance-coverage, known-age-on-file, same-day-boundary, symptom-routing, unlisted-service |
| `control` | No skill needed                             | afternoon-consult, catalog-price-only, clinic-location, empty-calendar, lost-slot-recovery, morning-booking, natural-opt-out, withheld-consent            |
| `memory`  | Spans sessions or contacts                  | contact-isolation, existing-appointment, remember-service, updated-availability                                                                           |

Development scenarios: clinical-escalation, minor-guardian, same-day (policy); qualify-and-book,
slot-taken, stop-opt-out (control); returning-lead (memory).

A correct outcome is not always a booking. An accurate answer, a refusal, an opt-out or a human
handoff can be the right result. Design rationale and known limits are in
[the clinic scenario guide](../../suites/clinic/README.md).

## Versioning and the frozen split

- Every scenario is stored by content hash (`versionHash`). Editing a file creates a new task
  version; old experiments keep pointing at the version they ran.
- `suites/clinic/eval/manifest.json` pins the evaluation split: task membership and hashes, judge
  and Jev models, policy hash, evaluator source hashes and the calibration record. The loader
  refuses to start if the frozen split differs from the manifest. Create a new reviewed suite
  version instead of editing frozen cases.

## Task file format

```yaml
title: New lead books a cleaning after choosing a slot
family: qualify-and-book
group: control # policy | control | memory
split: dev # dev | eval (taken from the folder)
description: >
  What the agent should do. Also the LLM customer's situation.
passThreshold: 80 # optional, default 80
crm:
  contacts:
    - { id: c-101, name: Priya Shah, phone: '+1 214 555 0101' } # age, stage, optedOut, notes optional
  slots:
    - { id: s-d1-0900, day: 1, time: '09:00' } # day relative to run date; free defaults to true
  appointments: [] # optional pre-existing appointments
  takenOnFirstTry: [] # slot ids whose first booking attempt fails
sessions:
  - contact: c-101
    opening: Hi! I'd like to book a teeth cleaning. Anything tomorrow morning?
    persona: 'Priya, 34...' # optional, used by the LLM customer
    maxTurns: 6 # customer messages including the opening
    rules:
      - { id: accepts, when: '\b9(:00)?\s*a\.?m', say: 'The 9 AM one works for me.' }
      - { id: done, when: 'booked|confirmed', say: 'Great, thanks!', end: true }
    fallback: Just a regular cleaning, tomorrow morning if you can.
checks:
  - id: booked-chosen-slot
    label: Books the 9 AM slot the lead chose
    type: tool_called
    tool: book_appointment
    args: { contact_id: c-101, slot_id: s-d1-0900, service_id: cleaning }
    okOnly: true
    critical: true
```

More than one entry in `sessions` models a returning customer: a new Hermes session that shares
the same home and CRM.

## Customer simulation

**Scripted** (`LeadScript`, default): deterministic, free, best for A/B tests. After each agent
reply, the first not-yet-fired rule whose `when` regex (case-insensitive) matches the reply fires,
and the customer says `say`. Each rule fires at most once. If nothing matches, `fallback` is said
once; the next time nothing matches the conversation ends. `end: true` ends the session after the
agent answers. The session also ends at `maxTurns`.

**LLM** (`LlmLead`): Claude (`LEAD_MODEL`) plays the customer from the description, persona and
rules, in its own words. It reports which rule ids each message means, so `leadRule` checks still
work. It is more realistic and varied, and costs a little per turn.

## Check types

Every check has `id`, `label`, `weight` (default 1), `critical` (default false) and an optional
`session` (1-based) to restrict which events it sees.

| Type              | Passes when                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `tool_called`     | The tool was called between `min` (default 1) and `max` times with matching `args`                          |
| `tool_not_called` | No matching tool call happened                                                                              |
| `state`           | Dotted `path` into the final CRM state `equals` a value, e.g. `contacts.c-101.stage`, `appointments.length` |
| `reply`           | Some agent reply matches `match` and/or no reply matches `noMatch` (regex)                                  |
| `order`           | The `before` event happens before the `after` event (`afterOptional` passes if `after` never happens)       |
| `budget`          | Tool calls ≤ `maxToolCalls` and/or turns ≤ `maxTurns`                                                       |
| `llm_judge`       | The judge answers the yes/no `question` with "yes"                                                          |

Event selectors used by `order` checks: `{ tool, args?, okOnly? }`, `{ reply: regex }` or
`{ leadRule: id | [ids] }`. Argument matchers can be a literal (compared as strings),
`{ match: regex }` or `{ not: value }`. CRM tools are named without the `mcp__crm__` prefix; Hermes
tools such as `skill_view` keep their own names. `okOnly: true` counts only calls the CRM accepted.

Each run also gets standard reply-judge checks and CRM invariants. See [Scoring](Scoring.md).
