import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createConfigurationSchema, type TaskDefinition } from '@evals/shared';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { vi } from 'vitest';
import { ConfigurationsService } from '../src/configurations/configurations.service.js';
import { DB, type Db } from '../src/db/db.module.js';
import { runs } from '../src/db/schema.js';
import { ExperimentsService } from '../src/experiments/experiments.service.js';
import { RunQueueService } from '../src/runner/run-queue.service.js';
import { TasksService, type TaskRow } from '../src/suites/tasks.service.js';
import { fakeJudge } from './fake-judge.js';
import { Judge } from '../src/scoring/judge.js';
import {
  GroundingSeverityClassifier,
  type TypeSafeSystemOneClient,
} from '../src/scoring/grounding-severity.js';
import type { ClaudeClient } from '../src/runner/anthropic.js';
import type { GradingCallUsage } from '../src/scoring/grading-usage.js';

const schema = `grading_usage_${randomBytes(5).toString('hex')}`;
const dir = mkdtempSync(join(tmpdir(), 'evals-grading-usage-'));
const skillsDir = join(dir, 'skills');
cpSync(fileURLToPath(new URL('../../../skills', import.meta.url)), skillsDir, { recursive: true });
Object.assign(process.env, {
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://evals:evals-local-only@127.0.0.1:55433/evals',
  DB_SCHEMA: schema,
  RUNS_DIR: join(dir, 'runs'),
  SKILLS_DIR: skillsDir,
  SUITES_DIR: fileURLToPath(new URL('../../../suites', import.meta.url)),
  HERMES_BIN: fileURLToPath(new URL('./fake-hermes.mjs', import.meta.url)),
  OPENAI_API_KEY: 'sk-test-only',
  RUN_CONCURRENCY: '2',
});
let app: INestApplication, db: Db, queue: RunQueueService, service: ExperimentsService;
let configurations: ConfigurationsService, task: TaskRow, baseline: string, candidate: string;
const spec = { provider: 'openai', model: 'gpt-test', systemPrompt: 'Clinic SMS assistant.' };
beforeAll(async () => {
  const { AppModule } = await import('../src/app.module.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  db = app.get(DB);
  queue = app.get(RunQueueService);
  service = app.get(ExperimentsService);
  configurations = app.get(ConfigurationsService);
  clearInterval((queue as unknown as { timer: NodeJS.Timeout }).timer);
  queue.backoffScale = 0;
  queue.settings.judge = fakeJudge();
  baseline = (await configurations.create(createConfigurationSchema.parse({ name: 'A', spec }))).id;
  candidate = (await configurations.create(createConfigurationSchema.parse({ name: 'B', spec })))
    .id;
  task = (await app.get(TasksService).list()).find((t) => t.key === 'qualify-and-book')!;
});
afterEach(async () => {
  await until(() => (queue as unknown as { active: Map<string, unknown> }).active.size === 0);
  queue.settings.judge = fakeJudge();
  queue.settings.extraEnv = undefined;
  queue.persistenceRetryMs = 1;
  vi.restoreAllMocks();
});
afterAll(async () => {
  await app.close();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`drop schema ${schema} cascade`);
  await pool.end();
  rmSync(dir, { recursive: true, force: true });
});
async function until(predicate: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Lifecycle regression timed out');
}
async function draft(configId = candidate) {
  return service.create({
    name: 'Lifecycle regression',
    hypothesis: '',
    baselineConfigId: baseline,
    candidateConfigId: configId,
    taskIds: [task.id],
    repetitions: 1,
    leadMode: 'scripted',
  });
}
async function records(id: string) {
  return db.select().from(runs).where(eq(runs.experimentId, id));
}

// Real evaluator pipeline, fake provider transports. Every returned response has known usage.
function providerFixture(failure: 'primary' | 'review' | 'classifier' | 'none', tokens = 1000) {
  const fixture = { failure, calls: { primary: 0, review: 0, classifier: 0 } };
  const client = {
    parse: async (params: { system: string; messages: { content: string }[] }) => {
      const review = params.system.startsWith('Grounding evidence review');
      if (review) {
        fixture.calls.review++;
        const proposed = JSON.parse(params.messages[0]!.content).proposed as {
          seq: number;
          quote: string;
          reason: string;
        }[];
        return {
          parsed_output: {
            decisions:
              fixture.failure === 'review'
                ? []
                : proposed.map((p) => ({
                    ...p,
                    basis: 'unsupported',
                    claimType: 'other',
                    action: null,
                    evidenceSeqs: [],
                  })),
          },
          stop_reason: 'end_turn',
          usage: { input_tokens: tokens, output_tokens: 0 },
        };
      }
      fixture.calls.primary++;
      const prompt = params.messages[0]!.content;
      const replies = [...prompt.matchAll(/#(\d+) AGENT REPLY \(sent to the lead\): (.*)/g)];
      const leads = [...prompt.matchAll(/#(\d+) LEAD:/g)];
      const good = { pass: true, quote: '', reason: 'Fixture' };
      return {
        parsed_output:
          fixture.failure === 'primary'
            ? null
            : {
                turns: replies.map((reply, i) => ({
                  seq: Number(reply[1]),
                  audience: good,
                  format: good,
                  grounded:
                    i === 0 ? { pass: false, quote: reply[2], reason: 'Review this claim' } : good,
                  act: 'informs',
                  issues: [],
                })),
                leadTurns: leads.map((lead) => ({
                  seq: Number(lead[1]),
                  intent: 'other',
                  mood: 'calm',
                })),
                questions: (task.definition as TaskDefinition).checks
                  .filter((c) => c.type === 'llm_judge')
                  .map((c) => ({ id: c.id, answer: 'yes', quote: '', reason: 'Fixture' })),
                outcome: { label: 'unresolved', reason: '' },
                leadConsistent: { ok: true, reason: '' },
              },
        stop_reason: 'end_turn',
        usage: { input_tokens: tokens, output_tokens: 0 },
      };
    },
  } as unknown as ClaudeClient;
  const classifier = new GroundingSeverityClassifier(
    {
      systemOne: async () => {
        fixture.calls.classifier++;
        return {
          model: 'jev-1.14.0',
          usage: { input_tokens: 1000, output_tokens: 0 },
          answers:
            fixture.failure === 'classifier'
              ? {}
              : {
                  claim_0: {
                    type: 'choice',
                    choice: 'serious',
                    confidence: 1,
                    probabilities: { minor: 0, serious: 1 },
                  },
                },
        };
      },
    } as unknown as TypeSafeSystemOneClient,
    'jev-1.14.0',
  );
  queue.settings.judge = new Judge(client, 'claude-sonnet-5-5', classifier);
  return fixture;
}
async function singleRun(priorCost = 0) {
  const fill = vi.spyOn(queue, 'fill').mockResolvedValue();
  const experiment = await draft();
  await service.start(experiment.id);
  const planned = await records(experiment.id);
  await db
    .update(runs)
    .set({ status: 'scored', passed: true, score: 100, costUsd: priorCost })
    .where(eq(runs.id, planned[0]!.id));
  fill.mockRestore();
  return { experiment, id: planned[1]!.id };
}

it('survives an idle pool disconnect and executes the next query on a replacement connection', async () => {
  const result = await db.execute<{ pid: number }>('select pg_backend_pid() as pid');
  const pid = result.rows[0]!.pid;
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const logged = vi.spyOn(Logger.prototype, 'error');
  try {
    await admin.query('select pg_terminate_backend($1)', [pid]);
    // Observe the production pool handler, without adding a test error listener that could hide its absence.
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith('Idle PostgreSQL connection failed', expect.any(String)),
    );
    const replacement = await db.execute<{ pid: number }>('select pg_backend_pid() as pid');
    expect(replacement.rows[0]!.pid).not.toBe(pid);
    const experiment = await draft();
    await service.start(experiment.id);
    await queue.drain(experiment.id);
    expect((await service.get(experiment.id)).counts.scored).toBe(2);
  } finally {
    await admin.end();
  }
});

it.each(['primary', 'review', 'classifier'] as const)(
  'retains returned %s-stage usage across exhausted automatic and manual retries',
  async (failure) => {
    const fixture = providerFixture(failure);
    const { experiment, id } = await singleRun();
    await queue.drain(experiment.id);
    const before = (await records(experiment.id)).find((run) => run.id === id)!;
    expect(before.status).toBe('error');
    const expectedEntries = failure === 'primary' ? 3 : failure === 'review' ? 6 : 9;
    expect(before.gradingUsage).toHaveLength(expectedEntries);
    const known = before.gradingUsage!.reduce((sum, call) => sum + (call.costUsd ?? 0), 0);
    expect(before.judgeCostUsd).toBeCloseTo(known);
    expect(before.judge).toBeNull();
    expect((await service.costs(experiment.id)).estimatedCostUsd).toBeCloseTo(known + 0.003);
    fixture.failure = 'none';
    await service.retryErrors(experiment.id);
    await queue.drain(experiment.id);
    const saved = (await records(experiment.id)).find((run) => run.id === id)!;
    expect(saved.status).toBe('scored');
    expect(saved.gradingUsage).toHaveLength(expectedEntries + 3);
    expect(saved.gradingUsage!.slice(0, expectedEntries)).toEqual(before.gradingUsage);
    expect(new Set(saved.gradingUsage!.map((call) => call.id)).size).toBe(
      saved.gradingUsage!.length,
    );
    expect(saved.judgeCostUsd).toBeCloseTo(
      saved.gradingUsage!.reduce((sum, call) => sum + (call.costUsd ?? 0), 0),
    );
    expect((await service.costs(experiment.id)).estimatedCostUsd).toBeCloseTo(
      saved.judgeCostUsd! + 0.003,
    );
    expect(readdirSync(join(queue.settings.runsDir, id))).toEqual(['attempt-1']);
  },
);

it.each([
  { prior: 24.95, primary: 1, review: 0 },
  { prior: 24.7, primary: 1, review: 1 },
])(
  'stops the next paid stage when returned usage reaches the cap: %j',
  async ({ prior, primary, review }) => {
    const fixture = providerFixture('none', 100_000);
    const { experiment, id } = await singleRun(prior);
    await queue.drain(experiment.id);
    expect(fixture.calls).toEqual({ primary, review, classifier: 0 });
    const saved = (await records(experiment.id)).find((run) => run.id === id)!;
    expect(saved).toMatchObject({ status: 'error', errorKind: 'cost_cap' });
    expect(saved.gradingUsage).toHaveLength(primary + review);
    expect((await service.get(experiment.id)).costUsd).toBeGreaterThan(25);
    await expect(service.retryErrors(experiment.id)).rejects.toMatchObject({ status: 409 });
    expect(fixture.calls).toEqual({ primary, review, classifier: 0 });
  },
);

it('deduplicates returned usage after a successful commit loses its acknowledgement', async () => {
  const internals = queue as unknown as {
    saveGradingUsage: (run: unknown, usage: GradingCallUsage) => Promise<void>;
  };
  const original = internals.saveGradingUsage.bind(queue);
  let lost = false;
  queue.persistenceRetryMs = 1;
  vi.spyOn(internals, 'saveGradingUsage').mockImplementation(async (run, usage) => {
    await original(run, usage);
    if (!lost) {
      lost = true;
      throw new Error('Injected lost usage commit acknowledgement');
    }
  });
  const fixture = providerFixture('none');
  const { experiment, id } = await singleRun();
  await queue.drain(experiment.id);
  const saved = (await records(experiment.id)).find((run) => run.id === id)!;
  expect(lost).toBe(true);
  expect(fixture.calls).toEqual({ primary: 1, review: 1, classifier: 1 });
  expect(saved.gradingUsage).toHaveLength(3);
  expect(saved.judgeCostUsd).toBeCloseTo(0.004042);
});

it('retains the owner and returned usage while cancellation races a database write outage', async () => {
  const internals = queue as unknown as {
    saveGradingUsage: (run: unknown, usage: GradingCallUsage) => Promise<void>;
    active: Map<string, unknown>;
  };
  const original = internals.saveGradingUsage.bind(queue);
  let unavailable = true,
    entered = false;
  queue.persistenceRetryMs = 1;
  vi.spyOn(internals, 'saveGradingUsage').mockImplementation(async (run, usage) => {
    if (unavailable) {
      entered = true;
      throw new Error('Injected usage write outage');
    }
    await original(run, usage);
  });
  const fixture = providerFixture('none');
  const progress: { runId: string | null; status: string }[] = [];
  const subscription = queue.progress.subscribe((event) => progress.push(event));
  const { experiment, id } = await singleRun();
  await queue.fill();
  await until(() => entered);
  try {
    await service.cancel(experiment.id);
    expect(internals.active.has(id)).toBe(true);
  } finally {
    unavailable = false;
  }
  await until(() => internals.active.size === 0);
  const saved = (await records(experiment.id)).find((run) => run.id === id)!;
  expect(saved.status).toBe('cancelled');
  expect(saved.gradingUsage).toHaveLength(1);
  expect(saved.judgeCostUsd).toBeCloseTo(0.002);
  expect(fixture.calls).toEqual({ primary: 1, review: 0, classifier: 0 });
  // A failure-write retry after the usage commit must not publish a contradictory error state.
  await (
    queue as unknown as { saveFailure: (run: unknown, error: unknown) => Promise<void> }
  ).saveFailure(saved, new Error('Late failure'));
  expect(progress.at(-1)).toMatchObject({ runId: id, status: 'cancelled' });
  subscription.unsubscribe();
});

it('keeps known costs beside unknown estimates and preserves an existing historical grading total', async () => {
  providerFixture('none');
  const { experiment, id } = await singleRun();
  await db.update(runs).set({ judgeCostUsd: 0.5 }).where(eq(runs.id, id));
  const run = (await records(experiment.id)).find((row) => row.id === id)!;
  const writer = queue as unknown as {
    saveGradingUsage: (run: unknown, usage: GradingCallUsage) => Promise<void>;
  };
  const unknown: GradingCallUsage = {
    id: 'unknown-call',
    component: 'judge',
    model: 'unknown',
    inputTokens: 100,
    outputTokens: 0,
    costUsd: null,
  };
  const known: GradingCallUsage = {
    id: 'known-call',
    component: 'review',
    model: 'known',
    inputTokens: 100,
    outputTokens: 0,
    costUsd: 0.2,
  };
  await writer.saveGradingUsage(run, unknown);
  await writer.saveGradingUsage(run, known);
  await writer.saveGradingUsage(run, known);
  const saved = (await records(experiment.id)).find((row) => row.id === id)!;
  expect(saved.gradingUsage).toHaveLength(3);
  expect(saved.judgeCostUsd).toBeCloseTo(0.7);
  const costs = await service.costs(experiment.id);
  expect(costs.estimatedCostUsd).toBeCloseTo(0.7);
  expect(costs.unknownEstimates).toBe(1);
  await service.cancel(experiment.id);
});

it('shutdown waits for a returned usage write and restart retains that spend while reusing the conversation', async () => {
  const internals = queue as unknown as {
    saveGradingUsage: (run: unknown, usage: GradingCallUsage) => Promise<void>;
    active: Map<string, unknown>;
    stopping: boolean;
  };
  const original = internals.saveGradingUsage.bind(queue);
  let unavailable = true,
    entered = false,
    stopped = false;
  queue.persistenceRetryMs = 1;
  vi.spyOn(internals, 'saveGradingUsage').mockImplementation(async (run, usage) => {
    if (unavailable) {
      entered = true;
      throw new Error('Injected shutdown usage outage');
    }
    await original(run, usage);
  });
  const fixture = providerFixture('none');
  const { experiment, id } = await singleRun();
  await queue.fill();
  await until(() => entered);
  const shutdown = queue.beforeApplicationShutdown().then(() => {
    stopped = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(stopped).toBe(false);
    expect(internals.active.has(id)).toBe(true);
  } finally {
    unavailable = false;
    await shutdown;
    internals.stopping = false;
  }
  const paused = (await records(experiment.id)).find((row) => row.id === id)!;
  expect(paused.status).toBe('queued');
  expect(paused.gradingUsage).toHaveLength(1);
  await queue.drain(experiment.id);
  const saved = (await records(experiment.id)).find((row) => row.id === id)!;
  expect(saved.status).toBe('scored');
  expect(saved.gradingUsage).toHaveLength(4);
  expect(saved.judgeCostUsd).toBeCloseTo(0.006042);
  expect(fixture.calls).toEqual({ primary: 2, review: 1, classifier: 1 });
  expect(readdirSync(join(queue.settings.runsDir, id))).toEqual(['attempt-1']);
});
