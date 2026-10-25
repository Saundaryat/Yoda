# Known limits and assumptions

Status: local end-to-end platform with deterministic v4.6 grading. The new native Anthropic forty-scenario experiment has 38 graded runs and 18/20 valid primary pairs: A 16/18, B 18/20, one B hard consent failure, and both agents stopping after an ambiguous reply. Two startup failures are retained; a separate readiness fix and four-run matched follow-up completed without infrastructure errors. A further consent-workflow-v1 revision reran both affected tasks under both arms: four completed, all passed 100 under v4.6, no hard failures. Both agents delivered a second offer after Maybe before receiving explicit consent. These targeted results remain separate from the original primary and startup-follow-up counts. The revised prompts have not had a full twenty-task rerun. Credential-free review, normal startup/draft cancellation and package integrity are verified. See the [final report](final-experiment.md) and [submission guide](../SUBMISSION.md). Historical reports remain unchanged.

## Runtime and integration

- Our NestJS/Vue/MCP/evaluation code is TypeScript. Hermes is an external Python dependency; document this interpretation of the assignment.
- The design relies on the locally documented Hermes Runs API and MCP support. Pin a runtime commit and verify sessions, profile restoration, cancellation, tool discovery, and usage in the first integration milestone.
- Hermes tool-event previews are truncated. Complete CRM evidence comes from our own MCP audit log; arbitrary third-party tool traces may lack sufficient detail.
- Core Hermes prompts, provider behavior, and automatic background state can affect results. Record effective configuration artifacts and disable uncontrolled learning where possible. Unknown core changes reduce reproducibility.
- A fresh session alone does not reset persistent memory. Restore an isolated profile snapshot before independent scenarios.
- MCP run binding and cancellation need real-runtime verification. The first release serializes its worker lane; concurrency requires separate profiles/connections and proven isolation.

## Domain coverage

- Mock CRM/calendar behavior does not establish correctness against real HighLevel APIs, SMS delivery, calendar races, or production permissions.
- The model can only use the tool allowlist. Disabling unrelated tools bounds the tested environment but limits claims about general-purpose Hermes behavior.
- Scripted leads and structured message intents make multi-turn evaluation repeatable, but are narrower than natural human dialogue. Unknown questions receive fixed clarification rather than inferred consent.
- Booking eligibility and policy are artificial fixtures, not medical or other professional advice.
- Fault schedules test selected failures, not all network/service behavior.
- Privacy tests can reliably catch seeded identifiable facts and scoped access attempts. General semantic disclosure may require additional human review or calibrated judges.

## Scoring and sensitivity

- Grader weights and score/pass thresholds are product choices that must be frozen and explained. They are not externally validated business-value measurements.
- Rejected unsafe attempts are still policy failures. Final-state-only evaluation would conceal them; reports must distinguish prevention by the service from compliance by the agent.
- Removing an instruction may not change the model's behavior. Lack of a score change is not evidence of grader insensitivity unless behavior changed in a relevant way.
- Synthetic mutations validate specific rules; they do not substitute for real Hermes experiments or estimate universal accuracy.
- Harmless rewording can alter stochastic model behavior. Deterministic trace controls and live prompt controls answer different questions.
- Reference configurations are not assumed perfect. Repair prompts are not guaranteed to improve outcomes.
- Optional LLM judging introduces its own biases, uncertainty, usage, and costs; deterministic grading is the MVP default.

## Statistics

- Twenty handcrafted cases with one repetition per configuration give limited coverage and no within-task reliability estimate. They share ten templates, so task-ID bootstrap intervals may understate family dependence. Repetitions would not be independent new tasks.
- Clustered bootstrap intervals describe suite-based uncertainty under task-sampling assumptions. They do not establish production-wide reliability.
- Few failures or identical observed outputs can yield misleadingly narrow intervals; surface sparse evidence and limited variation explicitly.
- Category and multiple-intervention analyses are exploratory unless separately designed and powered.
- Separate development/evaluation revisions prevent accidental mixing, but same-author template variants are not a genuinely independent holdout. Preserve this caveat and version any tuning/reused suite.
- Missing pairs, infrastructure errors, or ungradable results can bias complete-case analysis; show coverage and missing-outcome bounds. Do not declare a clean win from an incomplete comparison.
- An observed hard-failure rate of zero does not imply zero production risk.

## Operations and submission

- Local read-only review requires Node/npm and Docker. New live inference additionally requires an installed Hermes runtime and provider credentials.
- Model calls may leave the local machine through the configured provider. Seed only synthetic contact data.
- Provider prices and token accounting vary. Costs are estimates using dated rates and recorded actual runtime usage; absent usage is not zero cost.
- The initial worker is a single-process durable queue, with no distributed execution, team permissions, or hosted-service guarantees.
- Real cancellation observes a model-selected CRM action before stopping execution. Host-crash verification kills its own host after real gateway readiness and before inference, independently of provider quota. Both verify group removal; the unit guardian test also covers descendant teardown. These validate local POSIX behavior, not Windows, remote hosts, kernel failure, or every timing race. Restart never silently retries interrupted work.
- Suite import supports ten explicit scenario templates with constrained parameters, not arbitrary user-authored tool environments or workflows. Twenty evaluation cases share those templates; they are not twenty independent business domains.
- Evidence and assertion payload validation are automatic; general natural-language privacy leakage and human text/structured-intent consistency still require review.
- Current grader v4.6 checks message/intent agreement, conflicting appointment details, premature booking/payment claims and evidence-backed note facts. It retains offer/confirmation paraphrase fixes and validates typed prior age/consent/preference evidence, historical rejected slots and weekday/timezone claims. The driver validates age requests and slot offers before queuing replies. Checks remain bounded English/ISO rules; unfamiliar note vocabulary requires manual review and unusual valid wording may still false-fail. Historical grades remain unchanged; explicit versioned replay is required for new grader claims.
- Replayable SSE, polling fallback, and paired-task confidence comparisons are implemented. `npm start` orchestrates the host app; Compose packages PostgreSQL only. An installed Hermes runtime and configured provider are prerequisites, not provisioned from a clean machine automatically.
- Configuration UI edits instructions/provider/model only. Skills, toolsets, generation settings, arbitrary workflow code, and memory=true are unsupported. Memory is fixed false in the validated contract.
- The video and final report must use actual experiment results. Clearly label replayed traces, synthetic mutants, development runs, and saved demo experiments.

## Decisions to verify during implementation

1. Exact pinned Hermes revision and provider/model selected from available credentials.
2. Concrete profile process strategy that proves memory and MCP binding isolation.
3. Session continuation and how queued lead replies enter subsequent turns.
4. Provider usage/cache semantics and a valid dated price source.
5. Real pilot latency/cost before fixing final run budgets.
6. Test-set size and practical thresholds frozen before evaluation execution.
