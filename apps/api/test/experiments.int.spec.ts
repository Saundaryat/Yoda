import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { fakeJudge } from './fake-judge.js';
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
  queue.settings.judge = fakeJudge();
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
  it('exposes rescore provenance and original-score links without queueing runs', async () => {
    const id = await experiment(['qualify-and-book']);
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const rescoring = {
      sourceExperimentId: ids.baseline,
      evaluatorVersion: 'policy-grounding-v2',
      judgeOnlyCostUsd: 0.02,
    };
    try {
      await pool.query(`update ${schema}.experiments set analysis=$1 where id=$2`, [
        { rescoring, correctedExperimentId: ids.candidate },
        id,
      ]);
      const response = await api.get(`/api/experiments/${id}`).expect(200);
      expect(response.body.rescoring).toEqual(rescoring);
      expect(response.body.correctedExperimentId).toBe(ids.candidate);
      expect((await api.get(`/api/experiments/${id}/runs`)).body).toEqual([]);
    } finally {
      await pool.end();
    }
  });
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
    expect(summary.result).toEqual(results.comparison);
    const listed = (await api.get('/api/experiments')).body.find(
      (e: { id: string }) => e.id === id,
    );
    expect(listed.result).toEqual(results.comparison);

    const detail = (await api.get(`/api/runs/${runs[0]!.id}`).expect(200)).body;
    expect(detail.events[0]).toMatchObject({ kind: 'lead', seq: 1 });
    expect(detail.checks.length).toBeGreaterThan(0);
    expect(
      detail.checks.find((c: { checkId: string }) => c.checkId === 'reply-audience'),
    ).toMatchObject({ informational: true, passed: true });
    expect(detail.run.crmFinal.appointments).toHaveLength(1);
  });

  it('runs three versions, ranks them and compares any chosen pair', async () => {
    const spec = { provider: 'openai', model: 'gpt-test', systemPrompt: 'Third version.' };
    const third = (await api.post('/api/configurations').send({ name: 'C', spec }).expect(201)).body
      .id as string;
    const configIds = [ids.baseline, ids.candidate, third];
    await api
      .post('/api/experiments')
      .send({ name: 'bad', configIds: [ids.baseline, ids.baseline], taskIds: [ids['slot-taken']] })
      .expect(400);
    await api
      .post('/api/experiments')
      .send({
        name: 'bad',
        configIds,
        baselineConfigId: ids.baseline,
        candidateConfigId: ids.candidate,
        taskIds: [ids['slot-taken']],
      })
      .expect(400);
    const created = (
      await api
        .post('/api/experiments')
        .send({
          name: 'three',
          configIds,
          taskIds: [ids['qualify-and-book'], ids['slot-taken']],
          repetitions: 1,
        })
        .expect(201)
    ).body;
    expect(created).toMatchObject({
      configIds,
      baselineConfigId: ids.baseline,
      candidateConfigId: ids.candidate,
    });
    await api.post(`/api/experiments/${created.id}/start`).expect(201);
    await queue.drain(created.id);

    const runs = (await api.get(`/api/experiments/${created.id}/runs`)).body as {
      configId: string;
    }[];
    expect(runs).toHaveLength(6);
    // Each task's versions sit together, and the first version rotates between tasks.
    expect(new Set(runs.slice(0, 3).map((r) => r.configId)).size).toBe(3);
    expect(runs[0]!.configId).not.toBe(runs[3]!.configId);

    const results = (await api.get(`/api/experiments/${created.id}/results`).expect(200)).body;
    expect(results.pair).toEqual({ a: ids.baseline, b: ids.candidate });
    expect(results.coverage).toMatchObject({ plannedRuns: 6, scoredRuns: 6 });
    expect(results.leaderboard.entries.map((e: { letter: string }) => e.letter).sort()).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(results.leaderboard.comparisonConfidence).toBeCloseTo(0.975);
    const summary = (await api.get(`/api/experiments/${created.id}`)).body;
    expect(summary.result).toEqual(results.comparison);

    const chosen = (
      await api
        .get(`/api/experiments/${created.id}/results?a=${third}&b=${ids.candidate}`)
        .expect(200)
    ).body;
    expect(chosen.pair).toEqual({ a: third, b: ids.candidate });
    expect(chosen.comparison).toMatchObject({ pairedTasks: 2, plannedTasks: 2 });
    expect(
      chosen.tasks.every(
        (t: { a: unknown[]; b: unknown[] }) => t.a.length === 1 && t.b.length === 1,
      ),
    ).toBe(true);
    await api.get(`/api/experiments/${created.id}/results?a=${third}&b=${third}`).expect(400);

    const costs = (await api.get(`/api/experiments/${created.id}/costs`).expect(200)).body;
    expect(costs.rows.map((r: { label: string }) => r.label)).toEqual(
      expect.arrayContaining(['Agent A', 'Agent B', 'Agent C']),
    );
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

it('keeps missing critical judgments ungraded through storage, results and run inspection', async () => {
  const judge = queue.settings.judge;
  queue.settings.judge = null;
  try {
    const id = await experiment(['qualify-and-book']);
    await api.post(`/api/experiments/${id}/start`).expect(201);
    await queue.drain(id);
    const list = (await api.get(`/api/experiments/${id}/runs`)).body;
    expect(
      list.every(
        (r: { passed: boolean | null; score: number | null }) =>
          r.passed === null && r.score === null,
      ),
    ).toBe(true);
    const result = (await api.get(`/api/experiments/${id}/results`)).body;
    expect(result.coverage).toMatchObject({
      plannedRuns: 2,
      scoredRuns: 0,
      ungradedRuns: 2,
      openRuns: 0,
    });
    expect(result.comparison.verdict).toBe('incomplete');
    expect((await api.get(`/api/experiments/${id}`)).body.result).toEqual(result.comparison);
    expect(
      (await api.get(`/api/runs/${list[0].id}`)).body.checks.some(
        (c: { critical: boolean; skipped: boolean }) => c.critical && c.skipped,
      ),
    ).toBe(true);
  } finally {
    queue.settings.judge = judge;
  }
});

it('gates list and detail verdicts on every planned repetition, including missing run rows', async () => {
  const taskList = (await api.get('/api/tasks')).body.filter(
    (t: { split: string }) => t.split === 'eval',
  );
  const draft = (
    await api
      .post('/api/experiments')
      .send({
        name: 'Missing repetition regression',
        baselineConfigId: ids.baseline,
        candidateConfigId: ids.candidate,
        taskIds: taskList.map((t: { id: string }) => t.id),
        repetitions: 3,
      })
      .expect(201)
  ).body;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const t of taskList)
      for (const configId of [ids.baseline, ids.candidate])
        await pool.query(
          `insert into ${schema}.runs(experiment_id, task_id, config_id, repetition, position, status, passed, score) values($1,$2,$3,1,0,'scored',$4,$5)`,
          [
            draft.id,
            t.id,
            configId,
            configId === ids.candidate,
            configId === ids.candidate ? 100 : 0,
          ],
        );
    await pool.query(
      `update ${schema}.experiments set status='finished', finished_at=now() where id=$1`,
      [draft.id],
    );
    const result = (await api.get(`/api/experiments/${draft.id}/results`)).body;
    expect(result.coverage).toMatchObject({ plannedRuns: 120, scoredRuns: 40 });
    expect(result.comparison).toMatchObject({
      pairedTasks: 20,
      verdict: 'incomplete',
      complete: false,
    });
    expect((await api.get(`/api/experiments/${draft.id}`)).body.result).toEqual(result.comparison);
  } finally {
    await pool.end();
  }
});

it('reviews fresh grade changes by exact source-run identity with old/new evidence and excludes mismatches', async () => {
  const source = await experiment(['qualify-and-book'], 2);
  const current = await experiment(['qualify-and-book'], 2);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`update ${schema}.experiments set analysis=$1 where id=$2`, [
      {
        rescoring: {
          sourceExperimentId: source,
          evaluatorVersion: 'clinical-grounding-v4',
          mode: 'judge-and-score',
          judgeOnlyCostUsd: 0.1,
        },
      },
      current,
    ]);
    const insert = async (
      experimentId: string,
      configId: string,
      repetition: number,
      passed: boolean,
      score: number,
      sourceRunId?: string,
    ) =>
      (
        await pool.query(
          `insert into ${schema}.runs(experiment_id,task_id,config_id,repetition,position,status,passed,score,context) values($1,$2,$3,$4,0,'scored',$5,$6,$7) returning id`,
          [
            experimentId,
            ids['qualify-and-book'],
            configId,
            repetition,
            passed,
            score,
            sourceRunId ? { rescoring: { sourceRunId } } : {},
          ],
        )
      ).rows[0].id as string;
    const a = await insert(source, ids.baseline!, 1, true, 100);
    const b = await insert(source, ids.candidate!, 1, false, 50);
    const a2 = await insert(source, ids.baseline!, 2, false, 50);
    // Insert B before A: row/position order must never determine the pairing.
    const newB = await insert(current, ids.candidate!, 1, true, 100, b);
    const newA = await insert(current, ids.baseline!, 1, false, 90, a);
    await insert(current, ids.baseline!, 2, false, 70, a2);
    await insert(current, ids.baseline!, 3, false, 90, a);
    for (const [runId, passed, detail, eventSeq] of [
      [a, true, 'All replies backed by tools.', 1],
      [newA, false, 'Unsupported saved-note claim: "I saved it".', 5],
      [b, false, 'Unsupported appointment claim.', 4],
      [newB, true, 'Booking preceded the confirmation.', 6],
    ] as const)
      await pool.query(
        `insert into ${schema}.check_results(run_id,check_id,type,label,weight,critical,passed,detail,evidence) values($1,'reply-grounded','reply_judge','Grounded',2,true,$2,$3,$4)`,
        [runId, passed, detail, JSON.stringify([{ eventSeq }])],
      );
    const report = (await api.get(`/api/experiments/${current}/grade-changes`).expect(200)).body;
    expect(report).toMatchObject({
      comparedRuns: 3,
      unmatchedRuns: 1,
      passToFail: 1,
      failToPass: 1,
      scoreOnlyChanges: 1,
      unchanged: 0,
      mode: 'judge-and-score',
    });
    expect(report.changes[0]).toMatchObject({
      runId: newA,
      sourceRunId: a,
      side: 'A',
      previousPassed: true,
      passed: false,
      reasons: [
        {
          checkId: 'reply-grounded',
          previous: { passed: true, detail: 'All replies backed by tools.' },
          current: { passed: false, evidence: [{ eventSeq: 5 }] },
        },
      ],
    });
    expect(report.changes[1]).toMatchObject({
      runId: newB,
      sourceRunId: b,
      side: 'B',
      previousPassed: false,
      passed: true,
    });
    expect(report.changes[2]).toMatchObject({
      previousPassed: false,
      passed: false,
      previousScore: 50,
      score: 70,
      reasons: [],
    });
  } finally {
    await pool.end();
  }
});
