import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import type { RunQueueService } from '../src/runner/run-queue.service.js';

// Real Nest app + real Postgres (a throwaway schema) + the fake Hermes: everything but the model.
const schema = `test_${randomBytes(4).toString('hex')}`;
const runsDir = mkdtempSync(join(tmpdir(), 'evals-int-'));
Object.assign(process.env, {
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://evals:evals-local-only@127.0.0.1:55433/evals',
  DB_SCHEMA: schema,
  RUNS_DIR: runsDir,
  HERMES_BIN: fileURLToPath(new URL('./fake-hermes.mjs', import.meta.url)),
  SUITES_DIR: fileURLToPath(new URL('../../../suites', import.meta.url)),
  SKILLS_DIR: fileURLToPath(new URL('../../../skills', import.meta.url)),
  OPENAI_API_KEY: 'sk-test-only',
  RUN_CONCURRENCY: '2',
});

let app: INestApplication;
let queue: RunQueueService;
let api: ReturnType<typeof request>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const { AppModule } = await import('../src/app.module.js');
  const { RunQueueService } = await import('../src/runner/run-queue.service.js');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  await app.init();
  queue = app.get(RunQueueService);
  queue.backoffScale = 0;
  api = request(app.getHttpServer());

  const spec = {
    provider: 'openai',
    model: 'gpt-test',
    systemPrompt: 'You are the clinic SMS assistant.',
  };
  ids.baseline = (
    await api.post('/api/configurations').send({ name: 'A', spec }).expect(201)
  ).body.id;
  ids.candidate = (
    await api
      .post('/api/configurations')
      .send({ name: 'B', spec: { ...spec, skills: ['clinic-policy'] } })
      .expect(201)
  ).body.id;
  const tasks = (await api.get('/api/tasks').expect(200)).body as { id: string; key: string }[];
  for (const t of tasks) ids[t.key] = t.id;
});

afterAll(async () => {
  await app.close();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await pool.query(`drop schema ${schema} cascade`);
  await pool.end();
  rmSync(runsDir, { recursive: true, force: true });
});

async function experiment(taskKeys: string[], repetitions = 1) {
  const body = {
    name: 'test',
    baselineConfigId: ids.baseline,
    candidateConfigId: ids.candidate,
    taskIds: taskKeys.map((k) => ids[k]),
    repetitions,
  };
  return (await api.post('/api/experiments').send(body).expect(201)).body.id as string;
}

describe('experiments end to end', () => {
  it('creates a draft that runs nothing until started', async () => {
    const id = await experiment(['qualify-and-book']);
    const runs = await api.get(`/api/experiments/${id}/runs`).expect(200);
    expect(runs.body).toEqual([]);
    expect((await api.get(`/api/experiments/${id}`)).body.status).toBe('draft');
  });

  it('runs every task × configuration × repetition and scores them', async () => {
    const id = await experiment(['qualify-and-book', 'slot-taken'], 2);
    await api.post(`/api/experiments/${id}/start`).expect(201);
    await queue.drain(id);

    const summary = (await api.get(`/api/experiments/${id}`)).body;
    expect(summary).toMatchObject({
      status: 'finished',
      leadMode: 'scripted',
      counts: { scored: 8, error: 0 },
    });
    const runs = (await api.get(`/api/experiments/${id}/runs`)).body as {
      id: string;
      configId: string;
      passed: boolean;
    }[];
    // Pairs sit next to each other in the queue.
    expect(new Set([runs[0]!.configId, runs[1]!.configId]).size).toBe(2);
    expect(runs.every((r) => r.passed)).toBe(true);

    const results = (await api.get(`/api/experiments/${id}/results`).expect(200)).body;
    expect(results.comparison).toMatchObject({ pairedTasks: 2, plannedTasks: 2, difference: 0 });
    expect(results.coverage).toMatchObject({ plannedRuns: 8, scoredRuns: 8, openRuns: 0 });
    expect(results.tasks.map((t: { a: unknown[] }) => t.a.length)).toEqual([2, 2]);
    expect(results.metrics.costUsd.a).toBeGreaterThan(0);

    const detail = (await api.get(`/api/runs/${runs[0]!.id}`).expect(200)).body;
    expect(detail.events[0]).toMatchObject({ kind: 'lead', seq: 1 });
    expect(detail.checks.length).toBeGreaterThan(0);
    expect(detail.run.crmFinal.appointments).toHaveLength(1);
  });

  it('retries a rate-limited attempt from scratch and keeps the failure on record', async () => {
    const id = await experiment(['qualify-and-book']);
    queue.settings.extraEnv = {
      FAKE_HERMES_FAIL: 'rate_limit_once',
      FAKE_HERMES_MARKER: join(runsDir, `marker-${id}`),
    };
    await api.post(`/api/experiments/${id}/start`).expect(201);
    await queue.drain(id);
    queue.settings.extraEnv = undefined;

    const runs = (await api.get(`/api/experiments/${id}/runs`)).body as {
      id: string;
      attempts: number;
      status: string;
    }[];
    expect(runs.map((r) => r.status)).toEqual(['scored', 'scored']);
    const retried = runs.find((r) => r.attempts === 2)!;
    const detail = (await api.get(`/api/runs/${retried.id}`)).body;
    expect(detail.run.attemptLog).toEqual([
      expect.objectContaining({ attempt: 1, kind: 'rate_limit' }),
    ]);
  });

  it('refuses to run an LLM-lead experiment without ANTHROPIC_API_KEY, without retrying', async () => {
    const body = {
      name: 'llm lead',
      baselineConfigId: ids.baseline,
      candidateConfigId: ids.candidate,
      taskIds: [ids['qualify-and-book']],
      repetitions: 1,
      leadMode: 'llm',
    };
    const id = (await api.post('/api/experiments').send(body).expect(201)).body.id as string;
    await api.post(`/api/experiments/${id}/start`).expect(201);
    await queue.drain(id);
    const runs = (await api.get(`/api/experiments/${id}/runs`)).body as {
      errorKind: string;
      errorDetail: string;
    }[];
    expect(runs.map((r) => r.errorKind)).toEqual(['account', 'account']);
    expect(runs[0]!.errorDetail).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('stops the whole experiment on a bad key, and runs it after retry', async () => {
    const id = await experiment(['qualify-and-book', 'stop-opt-out']);
    queue.settings.extraEnv = { FAKE_HERMES_FAIL: 'account' };
    await api.post(`/api/experiments/${id}/start`).expect(201);
    await queue.drain(id);
    queue.settings.extraEnv = undefined;

    let summary = (await api.get(`/api/experiments/${id}`)).body;
    expect(summary).toMatchObject({ status: 'finished', counts: { error: 4, scored: 0 } });
    const runs = (await api.get(`/api/experiments/${id}/runs`)).body as {
      errorKind: string;
      attempts: number;
    }[];
    expect(runs.every((r) => r.errorKind === 'account')).toBe(true);
    expect(Math.max(...runs.map((r) => r.attempts))).toBeLessThanOrEqual(1);

    await api.post(`/api/experiments/${id}/retry-errors`).expect(201);
    await queue.drain(id);
    summary = (await api.get(`/api/experiments/${id}`)).body;
    expect(summary).toMatchObject({ status: 'finished', counts: { scored: 4, error: 0 } });
  });

  it('cancels queued and in-flight runs', async () => {
    const id = await experiment(['qualify-and-book', 'slot-taken', 'stop-opt-out']);
    queue.settings.extraEnv = { FAKE_HERMES_FAIL: 'hang' };
    await api.post(`/api/experiments/${id}/start`).expect(201);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await api.post(`/api/experiments/${id}/cancel`).expect(201);
    await queue.drain(id);
    queue.settings.extraEnv = undefined;

    const summary = (await api.get(`/api/experiments/${id}`)).body;
    expect(summary).toMatchObject({
      status: 'cancelled',
      counts: { cancelled: 6, running: 0, queued: 0 },
    });
  });
});
