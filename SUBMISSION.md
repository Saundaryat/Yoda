# Submission guide

Tracework is a local **NestJS + Vue 3 + TypeScript** evaluation platform with PostgreSQL and an external Hermes runtime. Install Node >=22.18/npm and start Docker, then run **`npm run review`** and open http://127.0.0.1:3001. This loads saved real Anthropic inference with current v4.5 replay grades, blocks writes, and needs no model credentials or Hermes installation. Use `npm start` for live experiments after the [runtime prerequisites](docs/runtime-setup.md).

| Deliverable | Location |
| --- | --- |
| Source, startup and tests | [README](README.md), `apps/`, `packages/`, `fixtures/`, `scripts/`, `tests/`, npm lockfile |
| Architecture and scope decisions | [Design](docs/design.md), [specification and deviations](SPEC.md) |
| Scoring, confidence and sensitivity | [Methodology](docs/evaluation-methodology.md), deterministic graders and regression tests |
| Real A/B experiment and remaining failures | [Final report](docs/final-experiment.md), primary `output/experiments/857ce98d-e957-4709-afd8-65f928828fb4/` and separate startup follow-up `7454dcc5-0a02-4998-af58-7163ba001d94/` |
| Approximate operating costs | [Captured usage and sourced Anthropic rates](docs/costs.md); actual invoice unknown |
| Working-system video | [Captioned recording](output/demo/tracework-demo.webm), [recording disclosure](docs/demo-script.md) |
| Limits and lifecycle evidence | [Limitations](docs/limitations.md), [cancellation](output/reliability/cancellation.json), [host-crash cleanup](output/reliability/crash.json) |

## What the experiment establishes

The new native Anthropic / Sonnet 4.6 comparison executed forty scenarios with the shared reliable-workflow amendment: **A passes 16/18, B 18/20** under v4.5 replay. Two A tool-discovery failures leave **18/20 primary pairs**. The paired success difference is zero, with 95% interval −16.67 to +16.67 percentage points: **inconclusive**. B has one hard consent violation, and both configurations stop prematurely after an ambiguous reply. A also retains its deliberate stale-slot handoff failure. The report traces these failures to actual evidence; near-perfect diagnostic scores cannot override mandatory failures.

A bounded pre-inference startup retry fix was followed by a separate matched rerun of the two affected tasks under both configurations: all four completed, zero infrastructure errors, A 1/2 and B 2/2. A’s remaining failure is the expected handoff baseline. The follow-up is not substituted into the primary experiment. Original inference grades, source exports, protocols and all versioned replays are preserved. Earlier Copilot results and quota failures remain separate history.

## Verification and scope

Verification passes **187 unit checks, nine isolated PostgreSQL/API checks, backend/frontend TypeScript checking, the production build, and two read-only browser checks**. One mutating browser walkthrough is intentionally skipped in review mode; API integration checks cover writes and lifecycle transitions. Current v4.5 replay verifies 112 saved grades across five separate cohorts, resolves assertion event references and preserves every original hard failure. [Replay evidence](output/reliability/final-replay-verification.json).

Fresh setup is checked without existing dependencies, `.env`, Hermes or provider access: it installs the lockfile, starts a disposable Docker database, serves the production UI/API and saved evidence, rejects review mutations, passes unit tests, then verifies normal startup with draft creation/cancellation and no inference. [Fresh verification](output/reliability/fresh-setup.json). The exact final archive is also checksum-checked, its Git bundle cloned, every file hash compared, and cold startup repeated from that clone; the accompanying `output/submission/package-verification.json` records that result.

Remaining limitations are explicit: one repetition on twenty builder-authored cases sharing ten templates; no untouched holdout or broad production reliability claim; bounded semantic checks; a local single worker; prompt/provider/model editing with memory disabled and a fixed toolset. Hermes is an external Python runtime, while the platform is TypeScript. New model execution requires the evaluator’s installed pinned runtime and usable provider access. These are scope limits, not claims of implemented features.

## Package and checksums

The local package is `output/submission/tracework-submission.tar.gz`. It contains source, curated synthetic-data evidence, documentation, video, a complete Git bundle, source-commit/file-hash manifest, and SHA-256 checksums. It excludes secrets, private runtime profiles/logs, dependencies, the external Hermes checkout, unrelated workspace projects and the PostgreSQL data volume.

From the extracted package:

```bash
shasum -a 256 -c output/submission/CHECKSUMS.sha256
git clone output/submission/tracework-source.bundle tracework
cd tracework
npm run review
```

The review database contains separately identified copies with source hashes; original exported traces stay unchanged and no execution is queued. The recording shows the actual UI displaying these saved real runs and makes no model calls. The October 21 video remains archived separately.

To rebuild after a reviewed Git commit, run `npm run package:submission`, then `npm run verify:package`. The package remains local until the owner sends or uploads it.
