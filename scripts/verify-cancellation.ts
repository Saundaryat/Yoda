import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { createEvaluationApp } from '../apps/api/app.ts';
import { Store, defaultDatabaseUrl } from '../apps/api/store.ts';
const url = process.env.DATABASE_URL ?? defaultDatabaseUrl;
const schema = `eval_test_cancel_${randomUUID().replaceAll('-', '')}`;
const admin = new Pool({ connectionString: url });
await admin.query(`CREATE SCHEMA "${schema}"`);
const app = await createEvaluationApp({ store: new Store(url, schema), logger: false });
try {
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const req = async (path: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    assert.ok(response.ok, `HTTP ${response.status}`); return await response.json();
  };
  const suite = (await req('/task-suites')).find((s: any) => s.logical_id === 'clinic-development');
  const config = (await req('/configurations'))[0];
  const experiment = await req('/experiments', { suiteId: suite.id, configurationIds: [config.id], repetitions: 1, taskIds: ['qualify-and-book'] });
  await req(`/experiments/${experiment.id}/start`, {});
  let run: any;
  let observedModelAction = false;
  for (let i = 0; i < 180; i++) {
    run = (await req(`/experiments/${experiment.id}`)).runs[0];
    try {
      const state = JSON.parse(readFileSync(resolve('.eval-runtime', run.id, 'crm-state.json'), 'utf8'));
      if (state.events.some((e: any) => e.type === 'tool')) { observedModelAction = true; break; }
    } catch { /* Hermes is preparing its isolated home. */ }
    await delay(1000);
  }
  assert.ok(observedModelAction, 'Cancel only after a real model-selected CRM action');
  const start = Date.now();
  await req(`/experiments/${experiment.id}/cancel`, {});
  for (let i = 0; i < 90; i++) {
    run = (await req(`/experiments/${experiment.id}`)).runs[0];
    if (run.status === 'cancelled') break;
    await delay(500);
  }
  assert.equal(run.status, 'cancelled');
  const pid = run.runtime.processGroupId;
  assert.ok(pid);
  assert.throws(() => process.kill(-pid, 0), (error: any) => error.code === 'ESRCH');
  const report = { checkedAt: new Date().toISOString(), observedModelAction, cancellationMs: Date.now() - start, processGroupGone: true, run };
  const dir = resolve('output/reliability'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'cancellation.json'), JSON.stringify(report, null, 2));
  console.log(`Real Hermes cancellation verified in ${report.cancellationMs}ms; process group removed.`);
} finally {
  await app.close(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
}
