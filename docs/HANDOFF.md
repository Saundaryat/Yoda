# Handoff: Agent Evals on Hermes (2026-10-24)

## Goal

HighLevel take-home: a NestJS + Vue platform that plays booking conversations against the
NousResearch Hermes agent, scores them, compares two agent configurations (A vs B) with a stated
confidence, and shows where the agent can improve. The evaluator is what will be judged.

## Where things are

- Repo: `~/Documents/ChatGPT/agent-evals`, branch `highlevel-agent-evals`, pushed to
  `github.com/Saundaryat/Yoda` (private). Yoda's `main` is an unrelated Python skeleton: leave it.
- Run: `docker compose up --build` → http://127.0.0.1:3080. Needs `.env` with
  `ANTHROPIC_API_KEY` (never commit it).
- Hermes behaviour notes: `spike/NOTES.md`.

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

   Every failure must quote the reply word for word, and quotes are verified.

5. **Score**: the task checks, plus the critical "no unbacked claims" check, plus CRM rules
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
- `apps/api/src/scoring/`: `checks.ts`, `judge.ts`
- `apps/api/src/analysis/`: `statistics.ts`, `labels.ts`
- `apps/web/src/views/`: Experiment, Run, Compare pages
- Tests: `pnpm test` (unit, using a fake Hermes in `apps/api/test/fake-hermes.mjs`),
  `pnpm --filter @evals/api test:integration` (Postgres), `pnpm --filter @evals/web test:e2e`.
  CI is green.

## Current state

Latest run: 7 dev tasks × 1 run, Hermes on Claude Haiku 4.5, Claude playing the customer.

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

1. Judge severity for unbacked claims: serious fails the run, minor is noted only. Today's
   check is too strict.
2. Write the 20 eval tasks (8 policy, 8 control, 4 memory), keep them frozen, and run 3
   repetitions: about 120 runs, about $8.
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
- Don't reuse Zenarate code (e.g. the Jev classifier) in this repo: employer IP.
