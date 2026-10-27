# Yoda — Agent Evals on Hermes

Yoda helps you test whether a change to an AI agent improves its behavior. It runs two agent versions through the same customer scenarios, checks their conversations and CRM actions, and shows the results side by side.

An **eval** is a repeatable test. For example: a customer asks for an appointment, the agent checks availability, asks for consent, and books a slot. The eval checks whether those steps happened correctly, including what the agent told the customer.

The current suite uses a synthetic dental clinic with a mock CRM and calendar. No real customer records are involved.

## Start the app

The simplest setup uses **Docker with Compose**. The image includes the app and a pinned Hermes runtime; you do not need to install Hermes separately.

```bash
git clone https://github.com/Saundaryat/Yoda.git
cd Yoda
cp .env.example .env
```

Edit `.env` and set `ANTHROPIC_API_KEY` for the Claude judge. This key also supports Anthropic agent configurations and an optional LLM customer. If your agent configuration uses OpenAI, also set `OPENAI_API_KEY`.

```bash
docker compose up --build
```

Open **http://127.0.0.1:3080**. On a fresh database, create agent versions and experiments using the walkthrough below. Historical reports are available in [docs/experiments](docs/experiments); they are not automatically imported into a fresh database.

Starting the app and saving drafts do not run the agent. **Starting an experiment makes paid model calls**, including grading and, when selected, the simulated customer.

Stop with **Ctrl-C**. Use `docker compose down` to stop the services while retaining the saved database and run volumes. If port 3080 is occupied, use `APP_PORT=3081 docker compose up --build` and open port 3081.

## Run your first comparison

1. Open **Agent versions** and create a baseline, **A**. Choose its provider/model, write the instructions, and select its skills, memory, and tools.
2. Create candidate **B** with the change you want to test. For an instruction-only test, keep the model and other settings the same.
3. Open **Scenarios** to inspect the tasks. Use development scenarios while trying changes.
4. Create a **New experiment**. Choose A, B, scenarios, repetitions, and who plays the customer: scripted rules or an LLM. Write the hypothesis you want to test.
5. Select **Create experiment** to save a draft. Review the setup, then select **Start … runs**.
6. Compare the results, then open a scenario or individual run to inspect its conversation, tool calls, CRM changes, and grading evidence.

One **run** is one agent version attempting one scenario once. Repetitions give each version multiple attempts:

```text
20 scenarios × 2 agent versions × 3 repetitions = 120 runs
```

An experiment can compare up to six versions (A–F). A is the baseline; with three or more, the experiment page adds a leaderboard that ranks every version and compares each one with A (intervals widened with a Bonferroni adjustment), and you can pick any two versions for the detailed view. This is an example; the run count follows your selections. Start with a small development comparison to check your setup before running the full suite. The app's **How it works** page explains the same workflow.

## What gets tested?

The clinic suite contains **7 development scenarios** and **20 frozen evaluation scenarios**. Each scenario includes an opening message, starting CRM records, customer behavior, and checks for the expected outcome.

| Group              | Evaluation cases | Examples                                                                                    |
| ------------------ | ---------------: | ------------------------------------------------------------------------------------------- |
| Policy             |                8 | Minor/guardian requirements, clinical handoff, same-day rules, pricing and insurance claims |
| Controls           |                8 | Normal booking, no available slots, lost-slot recovery, opt-out, and refusal to book        |
| Context and memory |                4 | Returning customers, changed availability, existing appointments, and contact isolation     |

A successful scenario does not always end in a booking. An accurate answer, refusal, opt-out, or human handoff may be the correct outcome.

See [the scenario guide](suites/clinic/README.md), [development cases](suites/clinic/dev), and [evaluation cases](suites/clinic/eval). The evaluation manifest checks task hashes and membership to keep the frozen suite consistent.

## How an eval works

```text
Choose A and B + the same scenarios
                 ↓
Hermes handles each customer conversation using mock CRM tools
                 ↓
Save replies, tool calls, and CRM state
                 ↓
Run evidence checks and model-based grading
                 ↓
Compare pass rates, uncertainty, costs, and individual failures
```

Runs use isolated Hermes homes and CRM state. When a scenario spans multiple customer sessions, those sessions share that run's home and CRM so the eval can test continuity. Different runs start independently.

Agent versions, task definitions, and experiment setup are saved as snapshots. Changing a configuration or grading rule does not silently rewrite old results. Skill contents and evaluator settings are frozen for new experiments. If grading fails, retries reuse the saved conversation. See [experiment lifecycle and upgrade behavior](docs/experiment-lifecycle.md).

## How scoring works

The evaluator combines two kinds of checks:

- **Code checks** inspect tool calls, their order, and final CRM state. Examples include recording an opt-out or checking that consent came before a booking attempt.
- **Model-based checks** judge conversation behavior and whether claims are supported by the available evidence. Reply findings link back to the conversation and tool evidence.

A run passes when **all critical checks pass** and its weighted score reaches the scenario's threshold, **80/100 by default**. A high numeric score cannot override a critical failure. Missing required critical judgments leave the run ungraded.

Customer-facing style and SMS quality are reported separately from pass/fail. Unsupported factual or action claims can still fail the run. The optional Jev classifier helps distinguish minor and serious verified unsupported claims; without it, those claims are treated conservatively as serious.

Model judgments can be inconsistent. Inspect the evidence and the judge's reasons when a result is surprising. Calibration fixtures and known limits are documented in [the clinic guide](suites/clinic/README.md) and [the project handoff](docs/HANDOFF.md).

## Read the comparison

| Result                   | How to interpret it                                                                          |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| Observed pass rate       | How often each version passed, giving each scenario equal weight after averaging repetitions |
| A/B scored higher        | Which version had the higher observed pass rate in this test                                 |
| Confidence & methodology | The paired uncertainty interval and statistical assessment                                   |
| Scenarios                | Where the candidate improved, regressed, or stayed the same                                  |
| Metrics & evidence       | Reply quality, performance metrics, tool use, and saved setup/hypothesis                     |
| Costs                    | Estimated API usage spend, with agent, customer, and grading components                      |

A higher observed pass rate can still be **inconclusive**. The statistical assessment compares the paired 95% interval with a practical improvement margin of **10 percentage points**. Incomplete coverage or required grading produces an **incomplete** comparison.

For example, the documented full-suite [Grounded SMS comparison](docs/experiments/2026-10-25-grounded-sms-v3.md) completed 120 runs:

| Version                                       |        Passed |
| --------------------------------------------- | ------------: |
| A — V4 contact-continuity baseline, Haiku 4.5 | 38/60 (63.3%) |
| B — Grounded SMS workflow v3, Sonnet 4.6      | 57/60 (95.0%) |

The difference was **+31.7 percentage points**, with a 95% paired-task interval of **+13.3 to +51.7 points**: **better** under the configured margin. The prompt, model, and reasoning changed together, so this does not isolate the effect of the prompt. The report retains failures and questionable judgments for review.

These are results on a reused synthetic suite. They do not establish performance across all customers or production systems.

## Configuration and costs

Keep credentials in the ignored `.env` file. [`.env.example`](.env.example) lists the supported model keys and overrides.

| Setting                   | Purpose                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | Claude grading, optional LLM customer, and Anthropic agents                       |
| `OPENAI_API_KEY`          | OpenAI agent configurations                                                       |
| `LEAD_MODEL`              | Claude model used when an LLM plays the customer                                  |
| `JUDGE_MODEL`             | Claude model used for grading; choose a different model from the agent under test |
| `TYPESAFE_API_KEY`        | Optional Jev classification of verified unsupported claims                        |
| `MAX_EXPERIMENT_COST_USD` | Estimated-spend limit; defaults to $25                                            |
| `APP_PORT`                | Host port for the Docker app; defaults to 3080                                    |

Model keys must permit the selected models. The spend limit uses estimated usage, and failed attempts or provider retries may add costs. Use the experiment's cost breakdown to understand what was counted.

## Development and checks

For local development, use **Node.js 22.18+** and **pnpm 11.21.0**, matching `package.json`:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

Database/API integration and browser checks use PostgreSQL:

```bash
pnpm dev:db
DATABASE_URL=postgres://evals:evals-local-only@127.0.0.1:55433/evals pnpm --filter @evals/api test:integration
pnpm --filter @evals/web exec playwright install chromium
DATABASE_URL=postgres://evals:evals-local-only@127.0.0.1:55433/evals pnpm --filter @evals/web test:e2e
```

The integration/browser harnesses use test executors rather than real agent performance results. For the normal app, Docker is the complete runtime setup described above.

## Repository map

| Location                | Contents                                                             |
| ----------------------- | -------------------------------------------------------------------- |
| `apps/web/`             | Vue interface for setup, comparisons, and evidence review            |
| `apps/api/`             | NestJS API, experiment queue, Hermes runner, grading, and analysis   |
| `packages/crm/`         | Mock CRM/calendar tools exposed through MCP (Model Context Protocol) |
| `packages/shared/`      | Shared schemas, types, and comparison/cost contracts                 |
| `suites/clinic/`        | Development scenarios and frozen evaluation suite                    |
| `skills/clinic-policy/` | Clinic policy skill available to agent configurations                |
| `prompts/`              | Saved candidate instruction sets                                     |
| `docs/experiments/`     | Experiment protocols, reports, and verification evidence             |
| `docs/calibration/`     | Grader calibration results                                           |

For the current implementation history and remaining review questions, see [docs/HANDOFF.md](docs/HANDOFF.md).
