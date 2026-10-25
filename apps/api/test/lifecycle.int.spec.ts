import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createConfigurationSchema, type RunEvent } from '@evals/shared';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { vi } from 'vitest';
import { ConfigurationsService } from '../src/configurations/configurations.service.js';
import { DB, type Db } from '../src/db/db.module.js';
import { experiments, runs } from '../src/db/schema.js';
import { ExperimentsService } from '../src/experiments/experiments.service.js';
import { InfraError } from '../src/runner/hermes-cli.js';
import { RunQueueService } from '../src/runner/run-queue.service.js';
import { TasksService, type TaskRow } from '../src/suites/tasks.service.js';
import { fakeJudge } from './fake-judge.js';
import type { Judge } from '../src/scoring/judge.js';
function judgeWith(implementation: Judge['judge']): Judge {
  const judge = fakeJudge();
  judge.judge = implementation;
  return judge;
}

const schema = `lifecycle_${randomBytes(5).toString('hex')}`;
const dir = mkdtempSync(join(tmpdir(), 'evals-lifecycle-'));
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

it('starts a draft exactly once across simultaneous HTTP requests and enforces run uniqueness', async () => {
  const experiment = await draft();
  vi.spyOn(queue, 'fill').mockResolvedValue();
  const api = request(app.getHttpServer());
  const replies = await Promise.all([
    api.post(`/api/experiments/${experiment.id}/start`),
    api.post(`/api/experiments/${experiment.id}/start`),
  ]);
  expect(replies.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
  const saved = await records(experiment.id);
  expect(saved).toHaveLength(2);
  const run = saved[0]!;
  await expect(
    db.insert(runs).values({
      experimentId: run.experimentId,
      taskId: run.taskId,
      configId: run.configId,
      repetition: run.repetition,
      position: 99,
    }),
  ).rejects.toMatchObject({ cause: { code: '23505' } });
  await service.cancel(experiment.id);
});

it('retries a failed judge against checkpointed evidence without executing Hermes again', async () => {
  const fixture = fakeJudge();
  let first: RunEvent[] | undefined;
  let checkpointVisible = false;
  queue.settings.judge = judgeWith(
    vi.fn(async (...args: Parameters<typeof fixture.judge>) => {
      if (!first) {
        first = structuredClone(args[1]);
        const pending = await db.select().from(runs).where(eq(runs.status, 'running'));
        checkpointVisible = pending.some((run) => run.conversation !== null);
        throw new InfraError('provider_error', 'Malformed judge output');
      }
      return fixture.judge(...args);
    }),
  );
  const experiment = await draft();
  await service.start(experiment.id);
  await queue.drain(experiment.id);
  const retried = (await records(experiment.id)).find((r) => r.attempts === 2)!;
  expect(checkpointVisible).toBe(true);
  expect(retried.conversation?.events).toEqual(first);
  expect(readdirSync(join(queue.settings.runsDir, retried.id))).toEqual(['attempt-1']);
  expect(retried.sessionIds).toEqual(retried.conversation!.sessionIds);
  expect(retried.costUsd).toBeCloseTo(0.003);
  expect((await service.run(retried.id)).events).toEqual(first);
  expect(retried.attemptLog).toEqual([
    expect.objectContaining({ phase: 'grading', kind: 'provider_error' }),
  ]);
});

it('retains evidence after exhausted grading retries and explicit retry only grades that evidence', async () => {
  queue.settings.judge = judgeWith(async () => {
    throw new InfraError('provider_error', 'Judge unavailable');
  });
  const experiment = await draft();
  await service.start(experiment.id);
  await queue.drain(experiment.id);
  const before = await records(experiment.id);
  expect(before.every((r) => r.status === 'error' && r.conversation && r.passed === null)).toBe(
    true,
  );
  queue.settings.judge = fakeJudge();
  await service.retryErrors(experiment.id);
  await queue.drain(experiment.id);
  const after = await records(experiment.id);
  for (const run of after) {
    const original = before.find((r) => r.id === run.id)!;
    expect(run.status).toBe('scored');
    expect(run.conversation).toEqual(original.conversation);
    expect(run.attempts).toBeGreaterThan(original.attempts);
    expect(readdirSync(join(queue.settings.runsDir, run.id))).toEqual(['attempt-1']);
  }
});

it('cancels during grading promptly even when the judge ignores cancellation', async () => {
  let entered = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = fakeJudge();
  queue.settings.judge = judgeWith(async (...args: Parameters<typeof fixture.judge>) => {
    entered++;
    await gate;
    return fixture.judge(...args);
  });
  try {
    const experiment = await draft();
    await service.start(experiment.id);
    await until(() => entered === 2);
    await service.cancel(experiment.id);
    await until(() => (queue as unknown as { active: Map<string, unknown> }).active.size === 0);
    const saved = await records(experiment.id);
    expect(
      saved.every((r) => r.status === 'cancelled' && r.passed === null && r.judge === null),
    ).toBe(true);
    expect(saved.every((r) => r.conversation !== null)).toBe(true);
    await expect(service.retryErrors(experiment.id)).rejects.toMatchObject({ status: 409 });
  } finally {
    release();
  }
});

it('does not allow late failures to requeue cancelled runs', async () => {
  queue.settings.extraEnv = { FAKE_HERMES_FAIL: 'hang' };
  const experiment = await draft();
  await service.start(experiment.id);
  await until(() => (queue as unknown as { active: Map<string, unknown> }).active.size === 2);
  await service.cancel(experiment.id);
  await until(() => (queue as unknown as { active: Map<string, unknown> }).active.size === 0);
  expect((await records(experiment.id)).every((r) => r.status === 'cancelled')).toBe(true);
});

it('reconciles interrupted work with terminal parents and resumes only running experiments', async () => {
  const fill = vi.spyOn(queue, 'fill').mockResolvedValue();
  const cancelled = await draft();
  await service.start(cancelled.id);
  await db.update(experiments).set({ status: 'cancelled' }).where(eq(experiments.id, cancelled.id));
  const running = await draft();
  await service.start(running.id);
  await db.update(runs).set({ status: 'running' }).where(eq(runs.experimentId, cancelled.id));
  await db.update(runs).set({ status: 'running' }).where(eq(runs.experimentId, running.id));
  await queue.recoverInterrupted();
  expect((await records(cancelled.id)).every((r) => r.status === 'cancelled')).toBe(true);
  expect((await records(running.id)).every((r) => r.status === 'queued')).toBe(true);
  fill.mockRestore();
  await queue.drain(running.id);
  expect((await service.get(running.id)).status).toBe('finished');
});

it('reuses a durable conversation after a worker restart rather than rerunning the agent', async () => {
  queue.settings.judge = judgeWith(async () => {
    throw new InfraError('provider_error', 'Judge unavailable');
  });
  const experiment = await draft();
  await service.start(experiment.id);
  await queue.drain(experiment.id);
  const before = await records(experiment.id);
  await db
    .update(experiments)
    .set({ status: 'running', finishedAt: null })
    .where(eq(experiments.id, experiment.id));
  await db
    .update(runs)
    .set({ status: 'running', phaseAttempts: 0 })
    .where(eq(runs.experimentId, experiment.id));
  queue.settings.judge = fakeJudge();
  await queue.recoverInterrupted();
  await queue.drain(experiment.id);
  for (const run of await records(experiment.id)) {
    expect(run.conversation).toEqual(before.find((r) => r.id === run.id)!.conversation);
    expect(run.status).toBe('scored');
    expect(readdirSync(join(queue.settings.runsDir, run.id))).toEqual(['attempt-1']);
  }
});

it('freezes skill bytes when saving configurations and hashes changes into a new version', async () => {
  const path = join(skillsDir, 'clinic-policy', 'SKILL.md');
  const original = readFileSync(path, 'utf8');
  const input = createConfigurationSchema.parse({
    name: 'Frozen policy',
    spec: { ...spec, skills: ['clinic-policy'], skillMode: 'preloaded' },
  });
  try {
    const frozen = await configurations.create(input);
    writeFileSync(path, original + '\nPolicy changed after configuration creation.\n');
    const changed = await configurations.create(input);
    expect(changed.specHash).not.toBe(frozen.specHash);
    const experiment = await draft(frozen.id);
    await service.start(experiment.id);
    await queue.drain(experiment.id);
    const run = (await records(experiment.id)).find((r) => r.configId === frozen.id)!;
    expect(run.conversation!.context.groundingAuthority.preloadedPolicies).toEqual([
      { name: 'clinic-policy', content: original },
    ]);
  } finally {
    writeFileSync(path, original);
  }
});

it('rejects changed evaluator versions before starting or retrying paid work', async () => {
  const experiment = await draft();
  const [row] = await db.select().from(experiments).where(eq(experiments.id, experiment.id));
  await db
    .update(experiments)
    .set({
      executionSnapshot: { ...row!.executionSnapshot!, evaluatorVersion: 'retired-evaluator' },
    })
    .where(eq(experiments.id, experiment.id));
  await expect(service.start(experiment.id)).rejects.toMatchObject({ status: 409 });
  expect(await records(experiment.id)).toHaveLength(0);
});

it('refuses to resume a running experiment under a changed evaluator without model calls', async () => {
  const fill = vi.spyOn(queue, 'fill').mockResolvedValue();
  const experiment = await draft();
  await service.start(experiment.id);
  const [row] = await db.select().from(experiments).where(eq(experiments.id, experiment.id));
  await db
    .update(experiments)
    .set({
      executionSnapshot: { ...row!.executionSnapshot!, evaluatorVersion: 'retired-evaluator' },
    })
    .where(eq(experiments.id, experiment.id));
  fill.mockRestore();
  await queue.drain(experiment.id);
  const saved = await records(experiment.id);
  expect(
    saved.every(
      (run) => run.status === 'error' && run.errorKind === 'account' && run.conversation === null,
    ),
  ).toBe(true);
  expect(
    readdirSync(queue.settings.runsDir).some((name) => saved.some((run) => run.id === name)),
  ).toBe(false);
});

it('freezes an unstarted legacy draft once without changing its saved configuration', async () => {
  const experiment = await draft();
  await db
    .update(experiments)
    .set({ executionSnapshot: null })
    .where(eq(experiments.id, experiment.id));
  await service.start(experiment.id);
  await queue.drain(experiment.id);
  const [row] = await db.select().from(experiments).where(eq(experiments.id, experiment.id));
  expect(row!.executionSnapshot?.configurations[baseline]?.spec.model).toBe('gpt-test');
  expect((await service.get(experiment.id)).status).toBe('finished');
});

it('graceful shutdown preserves completed conversations for grading after restart', async () => {
  const fixture = fakeJudge();
  let entered = 0;
  queue.settings.judge = judgeWith(async () => {
    entered++;
    return new Promise<never>(() => {});
  });
  const experiment = await draft();
  await service.start(experiment.id);
  await until(() => entered === 2);
  const before = await records(experiment.id);
  await app.close();
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
  queue.settings.judge = fixture;
  queue.backoffScale = 0;
  expect((await records(experiment.id)).every((run) => run.status === 'queued')).toBe(true);
  await queue.drain(experiment.id);
  for (const run of await records(experiment.id)) {
    expect(run.status).toBe('scored');
    expect(run.conversation).toEqual(
      before.find((original) => original.id === run.id)!.conversation,
    );
    expect(readdirSync(join(queue.settings.runsDir, run.id))).toEqual(['attempt-1']);
  }
});

it('drain waits for experiment finalization after the last run outcome commits', async () => {
  const internals = queue as unknown as { afterRun: (id: string) => Promise<void> };
  const finalize = internals.afterRun.bind(queue);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(internals, 'afterRun').mockImplementation(async (id) => {
    await gate;
    return finalize(id);
  });
  const experiment = await draft();
  await service.start(experiment.id);
  await vi.waitFor(async () =>
    expect((await records(experiment.id)).every((run) => run.status === 'scored')).toBe(true),
  );
  let drained = false;
  const pending = queue.drain(experiment.id).then(() => {
    drained = true;
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(drained).toBe(false);
  } finally {
    release();
    await pending;
  }
  expect((await service.get(experiment.id)).status).toBe('finished');
});
