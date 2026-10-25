# Architecture and key decisions

Status: implemented local architecture: NestJS/PostgreSQL, Vue 3, twenty evaluation cases plus six development cases, deterministic v4.6 graders, paired analysis, replayable SSE, exports, and real cancellation/crash probes. The final native Anthropic primary experiment has forty attempts, 38 graded runs and 18 valid pairs; a separate four-run startup follow-up completed without infrastructure errors. Original frozen inference grades and current offline replays are distinct artifacts. Both native configurations executed the shared reliable-workflow amendment; original failures are preserved, and a subsequent four-run consent-workflow-v1 correction validates the two affected tasks under both arms. CRM uses private per-run files with database checkpoints. Historical milestone findings remain [here](milestone-1-verification.md).

## Services and repository

```text
apps/api/                 NestJS controllers, durable worker, experiment orchestration
apps/web/                 Vue 3 + TypeScript + Vite
apps/crm-mcp/             TypeScript MCP tools and deterministic lead driver
packages/contracts/       Validated task/configuration/event schemas
packages/eval-engine/     Deterministic graders and task-clustered statistics
fixtures/                 Six development JSON tasks and evaluation.ts
tests/                    Labeled golden traces, mutations, API/browser checks
packages/hermes/           External runtime runner and host-liveness guardian
docs/                     Design, methodology, known limits
docker-compose.yml        Loopback PostgreSQL only; npm start orchestrates host app
```

Use PostgreSQL for both persistence and a small durable job queue; avoid adding Redis for the single-worker MVP. Claim a queued run transactionally and store a lease/heartbeat. Enforce one active lease per Hermes profile. Keep the worker in the NestJS service initially, but prevent HTTP requests from executing long runs synchronously.

Milestone 2 uses parameterized SQL through `pg`, rather than adding an ORM. A session-level PostgreSQL advisory lock elects one worker per database schema. Transactional experiment/run claims use a consistent parent-first lock order with cancellation. The current worker recovers interrupted rows as infrastructure errors without automatic replay. Full surviving-process reconciliation and heartbeat-based distributed recovery remain out of scope.

CRM MCP is a private stdio subprocess per scenario. The worker writes initial fixture state before launch and checkpoints its full audit into PostgreSQL. There is no fixture/admin HTTP API exposed to the agent and no shared rebindable MCP server.

## Hermes adapter

The local checkout documents a Runs API, session IDs/history, instructions, idempotency keys, status polling, stop requests, usage, actual runtime metadata, and SSE tool previews. Relevant references:

- [Local API documentation](../hermes-agent/website/docs/user-guide/features/api-server.md)
- [Local MCP guide](../hermes-agent/website/docs/guides/use-mcp-with-hermes.md)

The verified checkout is pinned in the submission instructions and its actual commit is captured in each run. Hermes is installed on the host, not built into an image. The runner checks readiness and MCP discovery on scenario startup. This does not enforce a Git checkout pin against user overrides; changed runtime commits must be treated as another experimental factor.

```ts
interface HermesAdapter {
  verifyCapabilities(): Promise<Capabilities>;
  startTurn(input: TurnInput, idempotencyKey: string): Promise<ExternalRun>;
  streamEvents(run: ExternalRun): AsyncIterable<HermesEvent>;
  getStatus(run: ExternalRun): Promise<HermesStatus>;
  stop(run: ExternalRun): Promise<void>;
}
```

`TurnInput` includes the fresh scenario session ID, current lead message, and immutable configuration instructions. Continue the same session for subsequent lead turns. Verify the pinned runtime's history semantics with a real two-turn probe before implementing the suite. Never simultaneously supply contradictory session history and caller-authored history.

Use separate idempotency keys per scenario turn and attempt. Persist the request identity before network submission. Retry an uncertain creation with the exact same body/key. A provider failure or confirmed unsuccessful attempt must not be erased by retrying under the original result record.

Hermes owns its core prompt. Store our additional instructions and their hashes without claiming they replace the entire system prompt. Record profile/config files and skill snapshots as part of reproducibility. Disable unrelated tools, automatic skill changes, and background learning for fixed experiments where supported; report remaining runtime behavior as a limitation.

## Authoritative evidence

Hermes SSE tool events contain shortened previews and are for progress display. They are insufficient for exact argument/result grading. Record complete mock tool arguments, results, rejection reasons, and mutations inside the MCP service before responding to Hermes.

CRM events have stable event IDs and a monotonically allocated sequence in the single scenario process's state file. The full array is snapshotted into PostgreSQL. Use this order for consent/action causality, not wall clocks across services. Hermes lifecycle events retain a separate source order. The UI separates these timelines instead of inventing exact shared ordering.

Do not require private model reasoning. Evidence consists of observable messages, tool activity, and state. An agent explanation is not proof that a write occurred.

## Run scope and CRM invariants

The worker provisions a fresh fixture namespace, then binds its private MCP lane to that namespace. The model cannot choose or change the namespace. Initial implementation uses a single active scenario per lane. Stale requests from a previous run fail after binding revocation; do not activate the next binding until the prior process has stopped. If reliable binding lifetime cannot be established with a persistent gateway, use a per-run Hermes process/MCP connection instead. Verify this before allowing concurrent lanes.

The service enforces calendar validity, consent provenance, suppression, uniqueness, and tenant scope regardless of prompt. An unsafe attempt is still evaluation evidence even though the service rejects it. Fault schedules can inject stale slots or tool errors at named operations, identically for both configurations. They cannot turn off core protections.

`send_message` produces a persisted outbound message and advances a deterministic lead state machine. The resulting inbound reply is queued for the next Hermes turn. It never manufactures consent from an unknown question or from the agent's assertion that consent exists. Final appointment confirmation must reference a successful appointment ID and match actual stored details.

## Workflow policy

Represent the initial workflow as versioned instructions: qualify -> offer actual slot -> obtain consent -> book -> verify -> update CRM -> confirm. Recovery is explicit: slot rejection -> re-search -> offer alternative -> reconfirm -> retry.

The MCP service's safety gates are constant between prompt/workflow instruction comparisons. Host-side gates may be evaluated later, but are distinct configuration changes. If a gate is added, score prevented attempts and successful outcomes separately so the report does not attribute enforcement improvements to model reasoning.

## Persistence model

| Entity | Important persisted fields |
| --- | --- |
| SuiteRevision | Content hash, task revisions, split, schema version |
| TaskRevision | Prompt, fixture, lead script, fault schedule, assertions, limits |
| ConfigRevision | Requested model/provider, instructions, fixed memory=false, content hash; fixed tools |
| Experiment | Frozen revision IDs, order, repetitions, primary metric, analysis version |
| ScenarioRun | Task/config/repetition, session/profile, status, attempts, actual runtime |
| AgentTurn | Lead input, external run ID, lifecycle, output, usage, timeout |
| AuditEvent | Full tool/message record, source sequence, result, rejected attempt |
| StateSnapshot | Initial/final state and intermediate mutation references |
| AssertionResult | Rule/version, status, expected/actual, evidence references |
| Analysis | Aggregates, paired differences, cluster bootstrap, missingness |
| Cost reporting | Raw Hermes turn usage; actual bill unknown; illustrative assumptions documented separately |

Use foreign keys and unique constraints for experiment/task/config/repetition identity and per-run event sequence. JSONB stores validated task-specific payloads. Secrets stay in environment variables, never configuration exports or traces.

## APIs and live progress

See [SPEC.md](../SPEC.md) for endpoint inventory. REST manages definitions and state transitions. SSE publishes persisted progress with replay IDs; reconnecting reads missed persisted events. The UI can fall back to polling experiment status. Do not depend on Hermes event retention for application history.

Experiment results include valid-run coverage, task coverage, infra errors, ungradable outcomes, and partial/cancelled labels. The API returns raw and presentation-ready aggregates with a recorded analysis version. A downloaded experiment JSON includes snapshots and evidence so analysis can be reproduced offline.

## Isolation, errors, and cancellation

- Fixture access and mutation are scoped at the server connection, not by an agent-provided identifier.
- Serialize shared profile access and restore profile state before independent scenarios.
- Failures in the provider, driver, or fixture preparation are visible infrastructure errors.
- Healthy-runtime agent budget exhaustion is a task failure.
- Cancellation sends a stop request, waits for confirmed termination or kills the isolated process, revokes scope, and preserves the trace. Only then release the worker lane.
- A detached process-group guardian holds a liveness pipe from the host. Host death/pipe EOF triggers TERM then KILL of its own isolated Hermes/MCP group, even after SIGKILL of the host. Worker restart marks interrupted database rows as infrastructure errors, with no silent replay. No distributed heartbeat or remote-PID reconciliation is claimed.
- Missing evidence prevents the affected grade from passing. Do not invent zero tokens/cost when usage is absent.

## Local startup and costs

`npm start` checks npm dependencies, waits for Docker PostgreSQL, builds Vue, and launches NestJS serving both the static UI and API. Hermes and credentials must already be installed. Database migrations/seeding are idempotent. Environment overrides are listed in README; there is no credential template containing secrets. API health checks DB/worker readiness; actual provider/MCP readiness is checked when a scenario launches.

MVP excludes hosted deployment. Raw usage is retained per turn; cache/billing accumulation semantics and served metadata are not fully verified for this provider/pin. Costs remain unknown in API results. A separately labeled illustrative budget uses explicit assumptions rather than claiming a provider invoice. There are no judge-model calls. See [cost disclosure](costs.md).

`npm run review` loads separately identified, terminal copies of the native primary, startup-follow-up and consent-correction exports with verified source hashes and current offline grades. All mutation endpoints are blocked and the worker is disabled. New live configurations default to native Anthropic/Sonnet 4.6; explicit external dotenv loading imports only the Anthropic credential. Bounded tool-discovery retries apply before inference only, never to provider calls or CRM mutations.
