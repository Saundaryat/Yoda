import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Store, defaultDatabaseUrl } from '../../apps/api/store.ts';
import { consentEvidenceDirectory, loadSavedEvidence } from '../../apps/api/saved-evidence.ts';
import { createEvaluationApp } from '../../apps/api/app.ts';

test('read-only review imports real replay evidence idempotently and blocks execution and writes', { timeout: 30000 }, async () => {
  const url = process.env.DATABASE_URL ?? defaultDatabaseUrl;
  const schema = `eval_test_review_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: url });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const store = new Store(url, schema);
  let app: Awaited<ReturnType<typeof createEvaluationApp>> | undefined;
  try {
    await store.migrate();
    await store.seed();
    const id = await loadSavedEvidence(store);
    assert.equal(await loadSavedEvidence(store), id);
    assert.equal((await store.listExperiments()).length, 1);
    const runs = await store.runs(id);
    assert.equal(runs.length, 40);
    assert.equal(runs.filter(run => run.grade?.status === 'passed').length, 34);
    assert.equal(runs.filter(run => run.status === 'infra_error' && !run.grade).length, 2);
    assert.equal((await store.experiment(id)).snapshot.evidenceProvenance.newInference, false);
    const results = await store.results(id);
    assert.deepEqual(results.configurations.map(config => config.passed), [16, 18]);
    const failed = runs.find(run => run.grade?.hardFailures.includes('explicit_consent'))!;
    assert.ok((await store.events(failed.id)).some(event => event.event_id === 'event-5'));
    const correctionId = await loadSavedEvidence(store, consentEvidenceDirectory);
    assert.equal(await loadSavedEvidence(store, consentEvidenceDirectory), correctionId);
    assert.equal((await store.listExperiments()).length, 2);
    const correctedRuns = await store.runs(correctionId);
    assert.equal(correctedRuns.length, 4);
    assert.ok(correctedRuns.every(run => run.status === 'completed' && run.grade?.status === 'passed' && run.grade.score === 100 && run.grade.hardFailures.length === 0));
    assert.equal((await store.experiment(correctionId)).snapshot.evidenceProvenance.sourceWorkflowRevision, 'consent-workflow-v1');
    assert.deepEqual((await store.results(correctionId)).configurations.map(config => config.passed), [2, 2]);

    app = await createEvaluationApp({ store, readOnly: true, logger: false });
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api`;
    const health = await (await fetch(`${base}/health`)).json();
    assert.equal(health.readOnly, true);
    assert.equal(health.executor, 'saved-evidence');
    for (const path of ['/experiments', `/experiments/${id}/start`, `/experiments/${id}/cancel`, '/configurations', '/task-suites']) {
      const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      assert.equal(response.status, 403, path);
    }
    assert.equal((await fetch(`${base}/experiments/${id}/export`)).status, 200);
    assert.equal((await store.experiment(id)).status, 'failed');
  } finally {
    if (app) await app.close(); else await store.pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
