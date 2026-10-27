# Glossary

| Term                              | Meaning                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **A / B**                         | Baseline and candidate agent configurations compared in one experiment                               |
| **Agent configuration / version** | Immutable, hashed spec of the agent under test: provider, model, instructions, skills, memory, tools |
| **Scenario / task**               | One customer situation: CRM seed, customer sessions and checks (YAML in `suites/`)                   |
| **Development split**             | Scenarios for iteration and debugging                                                                |
| **Evaluation split**              | Frozen, calibrated scenarios pinned by `manifest.json` for final comparisons                         |
| **Group**                         | Scenario category: `policy`, `control` or `memory`                                                   |
| **Session**                       | One customer conversation; multiple sessions share a Hermes home and CRM to test continuity          |
| **Lead / customer**               | The simulated person texting the clinic: scripted rules or an LLM                                    |
| **Lead rule**                     | A scripted customer reply triggered when the agent's reply matches a regex                           |
| **Experiment**                    | A/B comparison over chosen scenarios, repetitions and customer mode                                  |
| **Repetition**                    | One more attempt per version per scenario                                                            |
| **Run**                           | One configuration attempting one scenario once                                                       |
| **Attempt**                       | One execution of a run; infrastructure failures can cause several                                    |
| **Check**                         | One scored assertion: code check, judge question, reply-judge check or CRM invariant                 |
| **Critical check**                | A check whose failure fails the run regardless of score                                              |
| **Informational check**           | Shown and compared but excluded from pass/fail (reply audience and format)                           |
| **Ungraded**                      | A run with a skipped critical check; it has no pass/fail                                             |
| **Grounded**                      | Every fact and completed action told to the customer is backed by earlier successful CRM results     |
| **Judge**                         | Claude model that grades each reply and answers task questions                                       |
| **Evidence review**               | Second pass that validates grounding findings against cited CRM events by claim type                 |
| **Jev**                           | Optional classifier that labels verified unsupported claims as minor or serious                      |
| **Evaluator version**             | Identifier of the scoring logic (`evidence-grounding-v10`); frozen into each experiment              |
| **Execution snapshot**            | Frozen experiment inputs: specs, skill contents, evaluator, models and limits                        |
| **Conversation checkpoint**       | Saved transcript and CRM state that grading retries reuse                                            |
| **Paired task bootstrap**         | Two-level resampling (scenarios, then runs) behind the 95% interval                                  |
| **Practical margin**              | 10 percentage points, the smallest difference treated as meaningful                                  |
| **Verdict**                       | `better`, `worse`, `no_meaningful_difference`, `inconclusive` or `incomplete`                        |
| **pass^k**                        | Share of scenarios where every repetition passed                                                     |
| **Hermes**                        | The Nous Research agent runtime that executes the agent under test                                   |
| **Hermes home**                   | Per-run directory with `config.yaml`, `SOUL.md`, skills and memory                                   |
| **MCP**                           | Model Context Protocol; how Hermes reaches the mock CRM tools                                        |
| **Cost cap**                      | `MAX_EXPERIMENT_COST_USD`; admission limit on recorded estimated spend                               |
