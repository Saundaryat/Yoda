CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS task_suites (
  id uuid PRIMARY KEY, logical_id text NOT NULL, version integer NOT NULL, content_hash text NOT NULL,
  definition jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(logical_id, version)
);
CREATE TABLE IF NOT EXISTS configurations (
  id uuid PRIMARY KEY, content_hash text NOT NULL UNIQUE, definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experiments (
  id uuid PRIMARY KEY, status text NOT NULL CHECK (status IN ('draft','queued','running','completed','failed','cancelled')),
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY, experiment_id uuid NOT NULL REFERENCES experiments(id), task_id text NOT NULL,
  configuration_id uuid NOT NULL REFERENCES configurations(id), repetition integer NOT NULL,
  execution_order integer NOT NULL, status text NOT NULL CHECK (status IN ('queued','running','grading','completed','agent_failed','infra_error','cancelled','ungradable')),
  task_snapshot jsonb NOT NULL, configuration_snapshot jsonb NOT NULL,
  initial_state jsonb, final_state jsonb, runtime jsonb, grade jsonb, error jsonb,
  started_at timestamptz, completed_at timestamptz,
  UNIQUE(experiment_id, task_id, configuration_id, repetition)
);
CREATE INDEX IF NOT EXISTS runs_queue ON runs(experiment_id, execution_order) WHERE status = 'queued';
CREATE TABLE IF NOT EXISTS run_events (
  run_id uuid NOT NULL REFERENCES runs(id), source text NOT NULL, event_id text NOT NULL,
  sequence integer NOT NULL, payload jsonb NOT NULL, PRIMARY KEY(run_id, source, event_id)
);
CREATE TABLE IF NOT EXISTS assertion_results (
  run_id uuid NOT NULL REFERENCES runs(id), rule text NOT NULL, status text NOT NULL,
  payload jsonb NOT NULL, PRIMARY KEY(run_id, rule)
);
CREATE TABLE IF NOT EXISTS experiment_events (
  sequence bigserial PRIMARY KEY, experiment_id uuid NOT NULL REFERENCES experiments(id),
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
