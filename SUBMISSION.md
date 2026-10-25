# Submission guide

Tracework is a working local NestJS + Vue 3 + TypeScript evaluation platform using PostgreSQL and an external Hermes runtime. Evaluators should start with `npm run review` after installing Node >=22.18/npm and starting Docker. Open http://127.0.0.1:3001. This loads saved real inference with v4.2 replay grades, blocks writes, and needs no Hermes/provider credentials. Use `npm start` for live execution after the [runtime prerequisites](docs/runtime-setup.md).

| Deliverable | Location |
| --- | --- |
| Source and startup | [README](README.md), `apps/`, `packages/`, `fixtures/`, `scripts/`, `tests/`, npm lockfile |
| Architecture and decisions | [Design](docs/design.md), [original specification and scope deviations](SPEC.md) |
| Grading, confidence, sensitivity | [Methodology](docs/evaluation-methodology.md), `packages/eval-engine/`, mutation/golden tests |
| Real two-configuration experiment | [Current final report](docs/final-experiment.md), protocol/export/replay/review under `output/experiments/b4df0b6e-35ff-4db2-a7ec-1de92db49f46/`; [historical report](docs/final-experiment-2026-10-21.md) preserved separately |
| Approximate costs | [Usage and explicit hypothetical budget](docs/costs.md); actual provider billing unknown |
| Working-system video | [Current captioned recording](output/demo/tracework-demo.webm), [script/disclosure](docs/demo-script.md); actual UI showing saved real inference with v4.2 replay grades, no new inference |
| Known limitations | [Limits](docs/limitations.md) |
| Lifecycle evidence | [Real mid-action cancellation](output/reliability/cancellation.json), [host-crash cleanup](output/reliability/crash.json) |

## What the experiment establishes

The corrected full-suite run attempted all forty scenarios with frozen v4.1 and the aligned-offer configurations. It produced 32 graded scenarios across 16/20 valid task pairs; eight attempts hit Copilot HTTP 429. The separate v4.2 offline replay corrects four false-positive-only grades: A passes 14/16 (87.5%), B 13/16 (81.25%). B−A remains −6.25 percentage points, with a recomputed 95% whole-task interval of −25 to +12.5; overall **inconclusive**. B retains two hard-failure runs. Original v4.1 results (A 12/16, B 11/16) are preserved. No synthetic or newly executed model result is included in replay denominators.

The report documents four fail-to-pass corrections and five remaining saved failures: two expected baseline outcomes and three genuine B errors involving a premature note/invalid confirmation reference, post-opt-out messaging, and missing CRM reply delivery. The new `reliable-workflow-v1` prompt/tool guidance addresses these behaviors and passes deterministic workflow regressions; a separate six-attempt validation of the three workflows under both configurations was entirely HTTP 429 and produced no valid grades. That new export is preserved separately; it does not validate the revision. The original exports, audited provider classification correction and earlier regrades remain unchanged.

## Delivery gaps to disclose

- Forty scenarios were attempted, but only 32 were gradable (16/20 pairs); eight were rate-limited. This is one repetition per configuration, not the originally proposed three/120 scenarios. Provider access must recover before a complete new comparison can be obtained.
- Fresh evaluator review and normal application startup/draft cancellation are verified. Live model execution still requires a separately installed, pinned Hermes runtime and usable provider access; those dependencies are not bundled.
- Configurations edit prompt/provider/model; memory is fixed disabled and tools are fixed. Arbitrary skills, generation settings, and memory benchmarks are not implemented.
- Twenty cases share ten scenario families, authored by the same builder. The suite is not a broad independent benchmark; confidence does not account for all family dependence.
- Deterministic scoring has bounded text checks, no general semantic judge, and no validated provider invoice accounting.

## Verification

The correction passed 138 unit checks, nine isolated PostgreSQL/API checks, and TypeScript checking. V4.2 replays 32 full-suite, 36 historical and two targeted saved grades, as separate cohorts. Source hashes, assertion evidence and preservation of all full-suite hard failures were verified; frozen analysis was recomputed. Historical checks additionally cover frontend types/build, browser workflows, startup, cancellation, host-crash cleanup and v3 replay. Two evaluator-review browser checks pass; the current video and screenshots show the v4.2 evidence view. One mutation walkthrough is intentionally skipped in read-only mode; API mutation/lifecycle behavior is covered by the database integration tests.

The package includes a complete Git bundle, a source-commit/file-hash manifest, and SHA-256 checksums. A fresh isolated source copy installed its own locked dependencies, served the production UI/API and saved evidence, rejected review-mode writes, and passed unit tests; normal startup and draft/cancel were also verified. See [fresh-setup evidence](output/reliability/fresh-setup.json).

The source archive excludes unrelated workspace projects, raw `.eval-runtime` profiles/logs, dependency environments, provider credentials, and the external Hermes checkout. Reinstall Hermes at the documented commit and configure credentials separately; source files alone do not include that runtime installation.

Generate or refresh the explicit-allowlist archive with `npm run package:submission`. Output: `output/submission/tracework-submission.tar.gz`. The archive includes this source and curated synthetic evidence/video, but not the PostgreSQL data volume. A clean `npm run review` database loads a separately identified review copy with source hashes; original exports remain unchanged. It does not queue any execution. The bundle can be cloned using `git clone output/submission/tracework-source.bundle tracework`. Verify extracted files with `shasum -a 256 -c output/submission/CHECKSUMS.sha256`. The package remains local until you choose to send or upload it.
