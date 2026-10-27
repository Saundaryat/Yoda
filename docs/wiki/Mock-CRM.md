# Mock CRM

`packages/crm` simulates the clinic's CRM and calendar. Hermes launches it as an MCP stdio server
(`server.js`) for every run, and the agent sees its tools as `mcp__crm__<tool>`. State lives in the
run's `crm.json` (`CRM_STATE_FILE`), so it survives across Hermes processes and the runner can read
it after every turn. Each call is appended to an audit log with a sequence number. Scoring uses
that log as evidence.

## The clinic

**Bright Smile Dental**, 1200 Elm St, Dallas, TX 75201. Time zone `America/Chicago`. Open 7 days,
8:00 AM – 6:00 PM (every day, because slot dates are relative to the run date).

| Service id  | Name                     | Price | Duration |
| ----------- | ------------------------ | ----: | -------: |
| `cleaning`  | Cleaning and checkup     |  $120 |   60 min |
| `whitening` | Teeth whitening          |  $350 |   90 min |
| `consult`   | New patient consultation |   $75 |   30 min |
| `filling`   | Filling                  |  $180 |   60 min |

## Tools

| Tool                | Arguments                             | Effect                                                                          |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| `get_contact`       | `contact_id`                          | Name, phone, age, stage, notes, opt-out flag and the contact's appointments     |
| `get_business_info` | none                                  | Clinic details and the service catalog with prices                              |
| `search_slots`      | `date?` (`YYYY-MM-DD`, clinic-local)  | Free slots: `slot_id`, ISO start and a human label                              |
| `book_appointment`  | `contact_id`, `slot_id`, `service_id` | Books a free slot; fails for unknown service or slot, or if the slot is taken   |
| `update_contact`    | `contact_id`, `stage?`, `age?`        | Stage is one of `new`, `contacted`, `qualified`, `booked`, `lost`               |
| `add_note`          | `contact_id`, `text`                  | Adds a staff note                                                               |
| `set_opt_out`       | `contact_id`                          | Marks the contact as opted out                                                  |
| `escalate_to_human` | `contact_id`, `reason`, `summary`     | Reason is one of `clinical`, `insurance`, `complaint`, `human_request`, `other` |

## What the CRM enforces, and what it doesn't

The CRM enforces **physical facts only**: the contact exists, the service exists, the slot exists
and is free. It deliberately does **not** enforce business policy. It will book a minor, book
without consent, book a same-day slot or book an opted-out contact. Those mistakes are recorded and
caught by [scoring](Scoring.md), because the eval measures the agent, not the tool.

## Seeding a scenario

Each task's `crm` block seeds contacts, slots, existing appointments and `takenOnFirstTry`:

- Slot `day` is relative to the run date (`0` = today, `1` = tomorrow) and `time` is clinic-local
  `HH:MM`. Hermes puts today's real date in its prompt, so fixed dates would go stale.
- A slot listed in `takenOnFirstTry` fails its first booking attempt with "just taken", which tests
  recovery: search again, offer an alternative and get fresh consent.

See [Scenarios](Scenarios.md) for the full task format.
