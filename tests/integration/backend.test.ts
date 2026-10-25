import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createEvaluationApp } from '../../apps/api/app.ts';
import { defaultDatabaseUrl, Store } from '../../apps/api/store.ts';
import type { Executor } from '../../apps/api/worker.ts';
import { ExperimentWorker } from '../../apps/api/worker.ts';
import { goldenTrace } from '../helpers/golden.ts';

test('NestJS API, PostgreSQL persistence, worker lifecycle, and grader evidence', { timeout: 45000 }, async t => {
  const url = process.env.DATABASE_URL ?? defaultDatabaseUrl;
  const schema = `eval_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  let mode: 'golden' | 'infra' | 'slow' | 'bad-content' = 'golden';
  const executor: Executor = {
    label: 'scripted-test',
    async execute(task, _config, runId, signal, checkpoint) {
      const trace = goldenTrace(task, runId);
      if (mode === 'bad-content') {
        const message = trace.finalState.events.find(e => e.arguments.intent === 'confirm_booking')!;
        message.arguments.text = 'Your appointment is CANCELLED. Do not attend. The cancelled appointment was 2026-11-03T14:00:00+05:30.';
        message.result.text = message.arguments.text;
        const note = trace.finalState.events.find(e => e.name === 'add_contact_note')!;
        note.arguments.note = 'The customer is 8 years old and never consented to a booking.';
        trace.finalState.notes[trace.finalState.notes.length - 1] = String(note.arguments.note);
      }
      await checkpoint(trace.initialState, trace.finalState, { testOnly: true });
      if (mode === 'infra') throw new Error('Deliberate test provider outage');
      if (mode === 'slow') await delay(10000, undefined, { signal });
      return { ...trace, runtime: { testOnly: true }, error: null, errorKind: null };
    },
  };
  let store = new Store(url, schema);
  let app = await createEvaluationApp({ store, executor, logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    let base = `${await app.getUrl()}/api`;
    async function request(path: string, body?: unknown, expected = body === undefined ? 200 : 201): Promise<any> {
      const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result;
    }
    async function untilTerminal(id: string): Promise<any> {
      for (let i = 0; i < 150; i++) {
        const value = await request(`/experiments/${id}`);
        if (['completed', 'failed', 'cancelled'].includes(value.status)) return value;
        await delay(50);
      }
      throw new Error('Timed out waiting for test experiment');
    }
    const suites = await request('/task-suites');
    const configs = await request('/configurations');
    const suiteId = suites[0].id;
    const configurationId = configs[0].id;
    const create = (extra = {}) => request('/experiments', { suiteId, configurationIds: [configurationId], repetitions: 1, ...extra });
    await t.test('readiness, seeded suite, validated input, and immutable revisions', async () => {
      assert.equal((await request('/health')).database, 'postgresql');
      assert.equal(suites[0].definition.tasks.length, 6);
      assert.equal((await request(`/task-suites/${suiteId}`)).id, suiteId);
      await request('/experiments', { suiteId: 'invalid', configurationIds: [] }, 400);
      await request('/configurations', { ...configs[0].definition, memoryEnabled: true }, 400);
      await request('/runs/not-a-uuid', undefined, 400);
      await request(`/runs/${randomUUID()}`, undefined, 404);
      await request('/task-suites', { ...suites[0].definition, name: 'Changed without version bump' }, 409);
      const same = await request('/task-suites', suites[0].definition);
      assert.equal(same.id, suiteId);
      const config = await request('/configurations', configs[0].definition);
      assert.equal(config.id, configurationId);
      await store.seed();
      assert.equal((await request('/task-suites')).length, 2);
    });
    await t.test('all six task traces are scored and persisted through actual HTTP endpoints', async () => {
      const experiment = await create();
      assert.equal(experiment.snapshot.executor, 'scripted-test');
      await request(`/experiments/${experiment.id}/start`, {});
      await request(`/experiments/${experiment.id}/start`, {}, 409);
      const completed = await untilTerminal(experiment.id);
      assert.equal(completed.status, 'completed');
      assert.equal(completed.runs.length, 6);
      for (const run of completed.runs) {
        assert.equal(run.grade.status, 'passed', JSON.stringify(run.grade));
        assert.equal(run.grade.score, 100);
        const events = await request(`/runs/${run.id}/events`);
        const assertions = await request(`/runs/${run.id}/grades`);
        assert.equal(events.length, run.final_state.events.length);
        const ids = new Set(events.map((e: any) => e.event_id));
        for (const assertion of assertions) for (const eventId of assertion.evidence.eventIds) assert.ok(ids.has(eventId));
        assert.equal((await request(`/runs/${run.id}`)).initial_state.runId, run.id);
      }
      assert.equal((await request(`/experiments/${experiment.id}/results`)).configurations[0].passed, 6);
      const progress = await request(`/experiments/${experiment.id}/events`);
      assert.ok(progress.some((e: any) => e.payload.type === 'experiment.finished'));
      assert.equal((await request(`/experiments/${experiment.id}/events?after=${progress.at(-1).sequence}`)).length, 0);
      await request(`/experiments/${experiment.id}/cancel`, {}, 409);
    });
    await t.test('two-configuration runs keep immutable snapshots and a single worker lease', async () => {
      const contender = new ExperimentWorker(store, executor);
      await assert.rejects(() => contender.onModuleInit(), /already owns/);
      const alternate = await request('/configurations', { ...configs[0].definition, name: 'Test alternative', instructions: 'A different test prompt.' });
      const experiment = await create({ configurationIds: [configurationId, alternate.id], taskIds: ['qualify-and-book'], repetitions: 2 });
      await request('/configurations', { ...alternate.definition, instructions: 'A later revision.' });
      await request(`/experiments/${experiment.id}/start`, {});
      const completed = await untilTerminal(experiment.id);
      assert.equal(completed.runs.length, 4);
      assert.equal(completed.runs.filter((r: any) => r.configuration_id === alternate.id).length, 2);
      assert.ok(completed.runs.filter((r: any) => r.configuration_id === alternate.id).every((r: any) => r.configuration_snapshot.instructions === 'A different test prompt.'));
      assert.ok((await request('/experiments')).some((e: any) => e.id === experiment.id));
      const results = await request(`/experiments/${experiment.id}/results`);
      assert.equal(results.comparison.validPairs, 2);
      assert.equal(results.comparison.taskClusters, 1);
      assert.equal(results.conclusion, 'inconclusive');
      assert.ok((await request(`/experiments/${experiment.id}/diff`)).changes.some((c: any) => c.field === 'instructions'));
      assert.equal((await request(`/experiments/${experiment.id}/export`)).evidence.length, 4);
      const progress = await request(`/experiments/${experiment.id}/events`);
      const stream = await fetch(`${base}/experiments/${experiment.id}/stream`, { headers: { 'Last-Event-ID': progress.at(-1).sequence } });
      assert.equal(stream.status, 200);
      const replay = await stream.text();
      assert.match(replay, /stream.terminal/);
      assert.doesNotMatch(replay, /run.finished/);
    });
    await t.test('wrong messages and false notes persist failed v4.2 assertions with inspectable evidence', async () => {
      mode = 'bad-content';
      try {
        const experiment = await create({ taskIds: ['qualify-and-book'] });
        await request(`/experiments/${experiment.id}/start`, {});
        const completed = await untilTerminal(experiment.id);
        const run = completed.runs[0];
        assert.equal(run.grade.version, 'clinic-deterministic-v4.2');
        assert.equal(run.grade.status, 'failed');
        assert.ok(run.grade.score < 100);
        const assertions = await request(`/runs/${run.id}/grades`);
        const events = await request(`/runs/${run.id}/events`);
        for (const rule of ['message_content_consistent', 'note_factuality']) {
          const assertion = assertions.find((a: any) => a.rule === rule);
          assert.equal(assertion.status, 'fail');
          assert.ok(assertion.evidence.eventIds.length > 0);
          for (const id of assertion.evidence.eventIds) assert.ok(events.some((e: any) => e.event_id === id));
        }
        const results = await request(`/experiments/${experiment.id}/results`);
        assert.equal(results.configurations[0].valid, 1);
        assert.equal(results.configurations[0].passed, 0);
      } finally { mode = 'golden'; }
    });
    await t.test('provider errors preserve trace evidence and remain infrastructure errors', async () => {
      mode = 'infra';
      const experiment = await create({ taskIds: ['qualify-and-book'] });
      await request(`/experiments/${experiment.id}/start`, {});
      const completed = await untilTerminal(experiment.id);
      assert.equal(completed.status, 'failed');
      assert.equal(completed.runs[0].status, 'infra_error');
      assert.equal(completed.runs[0].grade, null);
      assert.ok(completed.runs[0].final_state.events.length > 0);
      assert.equal((await request(`/experiments/${experiment.id}/results`)).configurations[0].valid, 0);
      mode = 'golden';
    });
    await t.test('cancellation stops active execution and cancels queued work', async () => {
      mode = 'slow';
      const experiment = await create();
      await request(`/experiments/${experiment.id}/start`, {});
      for (let i = 0; i < 60; i++) {
        if ((await request(`/experiments/${experiment.id}`)).runs.some((r: any) => r.status === 'running')) break;
        await delay(25);
      }
      await request(`/experiments/${experiment.id}/cancel`, {});
      for (let i = 0; i < 100; i++) {
        const cancelled = await request(`/experiments/${experiment.id}`);
        if (cancelled.runs.every((r: any) => r.status === 'cancelled')) break;
        await delay(25);
      }
      const cancelled = await request(`/experiments/${experiment.id}`);
      assert.equal(cancelled.status, 'cancelled');
      assert.ok(cancelled.runs.every((r: any) => r.status === 'cancelled'));
      const run = await store.run(cancelled.runs[0].id);
      await store.finish(run, 'completed', null);
      assert.equal((await store.run(run.id)).status, 'cancelled', 'A late completion cannot revive cancelled work');
      mode = 'golden';
    });
    await t.test('database survives backend restart and orphan work is not silently replayed', async () => {
      const experiment = await create({ taskIds: ['qualify-and-book'] });
      await app.close();
      await admin.query(`UPDATE "${schema}".experiments SET status='running' WHERE id=$1`, [experiment.id]);
      await admin.query(`UPDATE "${schema}".runs SET status='running' WHERE experiment_id=$1`, [experiment.id]);
      store = new Store(url, schema);
      app = await createEvaluationApp({ store, executor, logger: false });
      await app.listen(0, '127.0.0.1');
      base = `${await app.getUrl()}/api`;
      const recovered = await request(`/experiments/${experiment.id}`);
      assert.equal(recovered.status, 'failed');
      assert.equal(recovered.runs[0].status, 'infra_error');
      assert.match(recovered.runs[0].error.message, /no automatic replay/);
      assert.equal((await request('/task-suites')).length, 2);
    });
  } finally {
    await app.close();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
