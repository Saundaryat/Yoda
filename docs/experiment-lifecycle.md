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
