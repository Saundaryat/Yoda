import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createEvaluationApp } from '../apps/api/app.ts';

const app = await createEvaluationApp({ logger: false });
let experimentId: string | undefined;
try {
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return await response.json();
  };
  assert.equal((await request('/health')).executor, 'hermes');
  const suite = (await request('/task-suites')).find((s: any) => s.logical_id === 'clinic-development' && s.version === 1);
  const config = (await request('/configurations')).find((c: any) => c.definition.name === 'Reference workflow · reliable workflow v1');
  assert.ok(suite && config, 'Expected seeded suite and reference configuration');
  const taskIds = process.env.EVAL_VERIFY_TASKS?.split(',');
  const created = await request('/experiments', { suiteId: suite.id, configurationIds: [config.id], repetitions: 1, ...(taskIds ? { taskIds } : {}) });
  experimentId = created.id;
  await request(`/experiments/${experimentId}/start`, {});
  console.log(`Real backend experiment ${experimentId}: ${created.snapshot.plannedRuns} tasks`);
  let experiment: any;
  let previousProgress = '';
  for (let i = 0; i < 1500; i++) {
    experiment = await request(`/experiments/${experimentId}`);
    const progress = experiment.runs.map((r: any) => `${r.task_id}:${r.status}${r.grade ? `/${r.grade.status}` : ''}`).join(', ');
    if (progress !== previousProgress) { console.log(progress); previousProgress = progress; }
    if (['completed', 'failed', 'cancelled'].includes(experiment.status)) break;
    await delay(1000);
  }
  const results = await request(`/experiments/${experimentId}/results`);
  const evidence = [];
  for (const run of experiment.runs) {
    const events = await request(`/runs/${run.id}/events`);
    const assertions = await request(`/runs/${run.id}/grades`);
    evidence.push({ run, events, assertions });
  }
  const report = { recordedAt: new Date().toISOString(), kind: 'real-hermes-backend-integration', experiment, results, evidence };
  const dir = resolve(import.meta.dirname, '../output/backend', experimentId!);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ experimentId, status: experiment.status, results, report: resolve(dir, 'report.json') }, null, 2));
  assert.equal(experiment.status, 'completed');
  for (const { run, events, assertions } of evidence) {
    assert.equal(run.status, 'completed', `${run.task_id}: ${JSON.stringify(run.error)}`);
    assert.equal(run.grade?.status, 'passed', `${run.task_id}: ${JSON.stringify(assertions.filter((a: any) => a.status === 'fail'))}`);
    assert.equal(events.filter((e: any) => e.source === 'crm').length, run.final_state.events.length);
    assert.ok(events.some((e: any) => e.source === 'hermes'), 'Expected persisted Hermes lifecycle evidence');
    assert.equal(assertions.length, run.grade.assertions.length);
  }
} finally {
  await app.close();
}
