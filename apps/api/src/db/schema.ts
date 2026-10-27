import type { GradingCallUsage } from '../scoring/grading-usage.js';
import type { RunConversation } from '../runner/run-executor.js';
import type { ExecutionSnapshot } from '../runner/execution-snapshot.js';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * One row per (task file, content version). Task YAML files are loaded at startup; editing a file
 * adds a new version, so finished experiments keep pointing at exactly what they ran.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: uuid().primaryKey().defaultRandom(),
    suite: text().notNull(),
    key: text().notNull(),
    versionHash: text().notNull(),
    split: text({ enum: ['dev', 'eval'] }).notNull(),
    family: text().notNull(),
    title: text().notNull(),
    definition: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.suite, t.key, t.versionHash)],
);

/** Immutable once created: changing a configuration means saving a new one. */
export const configurations = pgTable('configurations', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  description: text().notNull().default(''),
  spec: jsonb().notNull(),
  specHash: text().notNull(),
  skillContents: jsonb().$type<Record<string, string>>(),
  createdAt: createdAt(),
});

export const experiments = pgTable('experiments', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  hypothesis: text().notNull().default(''),
  baselineConfigId: uuid()
    .notNull()
    .references(() => configurations.id),
  candidateConfigId: uuid()
    .notNull()
    .references(() => configurations.id),
  /** Every compared version, baseline first; baseline/candidate above mirror the first two. */
  configIds: uuid().array(),
  taskIds: uuid().array().notNull(),
  repetitions: integer().notNull(),
  leadMode: text({ enum: ['scripted', 'llm'] })
    .notNull()
    .default('scripted'),
  status: text({ enum: ['draft', 'running', 'finished', 'cancelled'] })
    .notNull()
    .default('draft'),
  analysis: jsonb(),
  executionSnapshot: jsonb().$type<ExecutionSnapshot>(),
  createdAt: createdAt(),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
});

/**
 * One scenario: a task under a configuration, repetition n. Doubles as the work queue
 * (`status = 'queued' and available_at <= now()`, claimed with FOR UPDATE SKIP LOCKED).
 */
export const runs = pgTable(
  'runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    experimentId: uuid()
      .notNull()
      .references(() => experiments.id),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id),
    configId: uuid()
      .notNull()
      .references(() => configurations.id),
    repetition: integer().notNull(),
    /** Queue order: A and B of the same task and repetition sit next to each other. */
    position: integer().notNull(),
    status: text({ enum: ['queued', 'running', 'scored', 'error', 'cancelled'] })
      .notNull()
      .default('queued'),
    availableAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    attempts: integer().notNull().default(0),
    /** Retries in the current execution or grading phase; reset by explicit retry. */
    phaseAttempts: integer().notNull().default(0),
    /** Durable evidence checkpoint: grading retries and restarts reuse this exact conversation. */
    conversation: jsonb().$type<RunConversation>(),
    /** Failed infrastructure attempts that were retried from scratch: [{attempt, kind, detail, at}]. */
    attemptLog: jsonb().notNull().default([]),
    errorKind: text(),
    errorDetail: text(),
    passed: boolean(),
    score: real(),
    inputTokens: integer(),
    outputTokens: integer(),
    costUsd: real(),
    costStatus: text(),
    /** What the LLM-played lead cost (kept apart so it doesn't blur the A/B cost comparison). */
    leadCostUsd: real(),
    /** The judge's per-reply verdicts and answers to the task's judge questions. */
    judge: jsonb(),
    judgeCostUsd: real(),
    /** Per-call returned grading usage, including failed attempts. Null for historical records. */
    gradingUsage: jsonb().$type<GradingCallUsage[]>(),
    durationMs: integer(),
    sessionIds: text().array().notNull().default([]),
    crmInitial: jsonb(),
    crmFinal: jsonb(),
    /** What Hermes saw: system prompt, skills, memory before/after. */
    context: jsonb(),
    leadFallbacks: integer(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index().on(t.status, t.position),
    index().on(t.experimentId),
    uniqueIndex('runs_experiment_task_config_repetition_unique').on(
      t.experimentId,
      t.taskId,
      t.configId,
      t.repetition,
    ),
  ],
);

/** The run's timeline: lead messages, agent replies, tool calls with results, driver notes. */
export const runEvents = pgTable(
  'run_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    seq: integer().notNull(),
    session: integer().notNull(),
    turn: integer().notNull(),
    kind: text({ enum: ['lead', 'agent', 'tool', 'note'] }).notNull(),
    /** The full RunEvent (see @evals/shared). */
    payload: jsonb().notNull(),
  },
  (t) => [uniqueIndex().on(t.runId, t.seq)],
);

export const checkResults = pgTable(
  'check_results',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    checkId: text().notNull(),
    type: text().notNull(),
    label: text().notNull(),
    weight: real().notNull(),
    critical: boolean().notNull(),
    passed: boolean().notNull(),
    skipped: boolean().notNull().default(false),
    informational: boolean().notNull().default(false),
    detail: text().notNull(),
    /** Pointers into the run: [{eventSeq?, statePath?}]. */
    evidence: jsonb().notNull().default([]),
  },
  (t) => [index().on(t.runId)],
);
