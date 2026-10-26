# Experiment lifecycle and durable grading

An experiment saves its effective inputs before it runs. New configurations store the selected
skill contents and include them in their version hash. Experiment snapshots retain those skill
contents, agent specifications, judge/classifier models, evaluator/comparison versions, customer
model, and execution limits. Credentials are read from the server environment and are never stored
in snapshots.

Starting an experiment locks its database row and creates the task/configuration/repetition runs
in the same transaction. A unique database index protects each run identity. Concurrent starts
return one success and one conflict. Cancellation, claims, retries, and outcome writes use the same
parent-row lock. Queue fills are serialized within the API process so overlapping requests cannot
exceed `RUN_CONCURRENCY`.

After the customer conversation finishes, the API commits its transcript, CRM states, runtime
context, usage, and session identifiers before calling the judge. Judge failures retry this saved
conversation without starting Hermes or regenerating customer messages. Exhausted grading retries
remain inspectable as errors; **Retry errors** resumes grading against the same checkpoint.
Execution failures before a completed conversation still retry from a fresh Hermes home.

The total attempt counter never resets, so manual retries cannot overwrite earlier attempt folders.
A separate phase counter bounds automatic retries for execution and grading. Failed provider
requests can still have usage that providers do not return; cost totals remain estimates.

Cancellation aborts agent, customer, judge, evidence-review, and classifier requests. Late results
cannot replace cancelled runs with scored results. During shutdown the worker waits for cancelled
work and credential cleanup before the database pool closes. On restart, work under a terminal
experiment is cancelled; interrupted work under a running experiment resumes its current phase.
Operate one API worker process per database schema; distributed leases and failover are outside
this local application's scope.

## Upgrading existing databases

Migration `0005_durable-experiments` adds snapshots, conversation checkpoints, phase counters, and
the unique run-identity index. It does not rewrite historical conversations, grades, or configuration
hashes. Existing duplicate run identities must be reviewed before applying the uniqueness index;
the migration fails instead of deleting or relabelling evidence.

Legacy configurations without stored skill contents are resolved once when a new experiment is
created. Unstarted legacy drafts freeze their inputs when first started. Previously started legacy
experiments without an execution snapshot cannot safely resume under an unknown evaluator; create
a new experiment or explicitly regrade their historical evidence. A snapshot whose evaluator or
judge/classifier settings differ from the installed runtime also stops before new model calls.
Restore the original evaluator settings or create a separate experiment rather than mixing grades.

Generated JSON under `docs/experiments/` and `docs/calibration/` retains its original bytes and is
excluded from Prettier. Maintained source and Markdown documentation remain format-checked.

## Recovery and admission guarantees

Every running run has a local owner or is recovered by the next worker poll. A worker retains its
owner, concurrency slot, and completed in-memory result while retrying a failed database write.
Conversation, outcome, and failure writes tolerate a successful commit with a lost acknowledgement:
repeating the write neither duplicates transcript events nor reopens a terminal run. A transient
write failure never starts the agent or judge again. Graceful shutdown waits for these writes; a
persistent database outage can therefore delay shutdown. A forced exit recovers from the last
committed conversation checkpoint after restart. No database can recover an uncommitted result
lost in a process crash.

Startup and normal polling both reconcile running experiments, reclaim unowned running rows, and
finish parents whose children are all terminal. This also repairs a crash between the final outcome
commit and parent finalization. Parent finalization is idempotent. Active owners are excluded from
reclamation. These ownership rules require **one API worker per database schema**; a second worker
would require distributed leases before it could safely use this recovery mechanism.

The worker checks total recorded agent, customer, and judge spend under the experiment lock before
claiming work and before starting grading. Manual retries use the same spend calculation and return
HTTP 409 at or above the cap, preserving the saved errors. Queued work becomes a `cost_cap` error.
This is an admission limit on recorded estimates: already admitted concurrent calls can finish
above the cap, and interrupted/provider calls without returned usage remain unmeasured.

Browser SSE messages are invalidation hints. Every connection, including a native reconnect,
reloads authoritative experiment, run, and cost state. The experiment view coalesces bursts without
continually postponing its refresh. No event replay is required to recover a missed final update.

## Evidence and ordering guarantees

Evaluator `evidence-grounding-v9` validates grounding evidence by claim type. A supported completed
action must identify the CRM operation, quote the completed-action clause, and cite an earlier,
successful execution of that operation for the same contact and session. Agent promises and CRM
reads cannot prove a completed mutation. Prior agent messages can establish prior communication;
they cannot establish current availability. Invalid reviewer evidence produces a grading error
instead of clearing the finding. Semantic interpretation of language still belongs to the judge;
these validators enforce the evidence contract around its interpretation.

Conditional availability plans (`if`, `when`, `once`, and related conditions) remain subject to
semantic judgment rather than being forced into a factual failure by the availability rule. A
separate affirmative availability assertion in the same reply still requires matching evidence.
Opt-out booking checks replay successful CRM audit entries from the initial contact state in
sequence order. A later opt-out does not invalidate an earlier booking. Legacy snapshots missing
needed ordering evidence remain ungraded instead of inventing chronology.

These scoring changes do not rewrite saved grades. The evaluator version change prevents unfinished
v8 experiments from resuming with v9 judgments; use an explicit regrade or a new experiment.
Regression coverage includes repeated write failures at each persistence boundary, lost commit
acknowledgements, startup and polling repair, cancellation and shutdown during recovery, concurrent
manual retries at the budget boundary, typed evidence sources, reordered tool sequences, paired
conditional/factual wording, and native browser reconnections without replayed state events.

## Returned grading usage and runtime error boundaries

Migration `0006_grading-call-usage` adds nullable `runs.grading_usage`. It leaves historical rows and
saved grades unchanged. For new grading work, each returned primary-judge, evidence-review, and
classifier response is recorded before its contents are validated or the next stage starts. This
includes refusals and malformed/partial grading reports that subsequently fail. Each call has a
stable id across database-write retries; a lost commit acknowledgement cannot charge it twice.
`judge_cost_usd` retains the sum of all known ledger estimates across automatic and manual retries,
instead of being overwritten by the final successful report. Unknown-priced components remain
explicit in the cost breakdown alongside known amounts. If a historical row already has recorded
grading cost, its first ledger write preserves that amount as a legacy component.

The worker checks spend and cancellation before each paid grading stage. Returned usage is retained
even if the experiment is subsequently cancelled. Cancellation and shutdown keep the owner until
any in-flight usage writes are durable. A copied/regraded run starts without its source call ledger
so the original work is never charged again. Existing conversations remain reusable on retry.
Provider requests that never return usage, and results lost in a forced process exit before their
usage is committed, remain outside the known estimate. Already admitted concurrent calls can still
complete above the admission cap.

Idle PostgreSQL client errors are logged at the pool boundary; `pg` discards that client and the
next query obtains a replacement. Active query failures continue through the normal transaction
and persistence retry paths. Hermes usage JSON is read and validated inside its subprocess callback;
unreadable, truncated, or structurally invalid reports reject as run infrastructure errors instead
of throwing out of the callback and terminating the API. Error messages do not echo the report.

Evaluator `evidence-grounding-v10` retains availability knowledge per CRM query scope: a filtered
search replaces only that date, a full search replaces all dates, and successful booking or a taken
result removes the affected slot. Only explicit affirmative waitlist statements/offers receive the
unsupported-service override; negated or indirect wording remains subject to semantic judgment.
Model reply/lead judgments are normalized by event sequence, and handling analysis also finds the
chronological next reply independently of stored array order. Unfinished experiments from earlier
evaluator versions cannot silently resume under these changed semantics; explicitly regrade or
start a new experiment.
