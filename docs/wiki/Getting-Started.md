# Getting started

## Requirements

- Docker with Compose. The app image already contains a pinned Hermes runtime
  (`nousresearch/hermes-agent:v0.22.4`, pinned by digest), so Hermes needs no separate install.
- An `ANTHROPIC_API_KEY`. It powers the Claude judge, the optional LLM-played customer and
  Anthropic agent configurations.
- An `OPENAI_API_KEY` only if an agent configuration uses the `openai` provider.

## Start the app

```bash
git clone https://github.com/Saundaryat/Yoda.git
cd Yoda
cp .env.example .env   # then fill in the keys you need
docker compose up --build
```

Open <http://127.0.0.1:3080>. Compose starts two services:

| Service | Image                   | Notes                                                                                                           |
| ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `db`    | `postgres:17-alpine`    | Data in the `pgdata` volume; exposed on `127.0.0.1:55433`                                                       |
| `app`   | built from `Dockerfile` | API + built web app on container port 3000, host port `APP_PORT` (default 3080); run homes in the `runs` volume |

Stop with Ctrl-C. `docker compose down` stops the services and keeps both volumes. If port 3080
is busy: `APP_PORT=3081 docker compose up --build`.

Starting the app and saving drafts cost nothing. **Starting an experiment makes paid model calls**
for the agent, the judge and, when selected, the LLM customer.

## Run a first comparison

1. **Configurations → New configuration.** Create baseline **A**: provider, model, reasoning,
   instructions, skills, memory and tools. See [Agent configurations](Agent-Configurations.md).
2. Create candidate **B** containing the one change you want to test. Keep everything else equal
   if you want to attribute the result to that change.
3. **Scenarios.** Inspect the tasks. Use the 7 development scenarios while iterating; use the 20
   frozen evaluation scenarios for the final comparison. See [Scenarios](Scenarios.md).
4. **New experiment.** Choose A, B, scenarios, repetitions (1–10, default 3) and who plays the
   customer: **scripted** (deterministic regex rules, no cost) or **LLM** (Claude plays a persona).
   Write the hypothesis before you run.
5. **Create experiment** saves a draft. Nothing runs yet. Review it, then **Start … runs**.
6. Watch progress live, then read the comparison and drill into scenarios and individual runs.
   See [Reading results](Reading-Results.md).

Run count = scenarios × 2 versions × repetitions. For example, 20 × 2 × 3 = 120 runs. Start with a
small development experiment to check keys and setup before a full-suite run.

## Historical results

Reports in [docs/experiments](../experiments/) document earlier comparisons. They are **not**
imported into a fresh database.
