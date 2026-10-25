import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from '../apps/api/store.ts';
import { providerFailure } from '../packages/hermes/provider-errors.ts';
const id = process.argv[2];
if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Supply the exact terminal experiment UUID');
const store = new Store();
try {
  const original = await store.exportExperiment(id);
  if (!['completed', 'failed', 'cancelled'].includes(original.experiment.status)) throw new Error('Never reconcile active execution');
  const directory = resolve('output/experiments', id);
  // Exclusive creation prevents overwriting the original pre-correction evidence.
  try { writeFileSync(resolve(directory, 'report-before-reconciliation.json'), JSON.stringify(original, null, 2), { flag: 'wx' }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const corrections: unknown[] = [];
  for (const { run } of original.evidence) {
    if (run.status !== 'agent_failed') continue;
    const log = readFileSync(resolve('.eval-runtime', run.id, 'gateway.log'), 'utf8');
    const reason = providerFailure(log);
    if (!reason) continue;
    const correction = { version: 'provider-error-classification-v1', correctedAt: new Date().toISOString(),
      reason, logSha256: createHash('sha256').update(log).digest('hex'),
      previousStatus: run.status, previousGrade: run.grade, previousError: run.error };
    await store.transaction(async client => {
      const updated = await client.query("UPDATE runs SET status='infra_error',grade=NULL,error=$2,runtime=runtime || $3::jsonb WHERE id=$1 AND status='agent_failed' RETURNING id",
        [run.id, { message: reason }, JSON.stringify({ classificationCorrection: correction, errorKind: 'infra_error' })]);
      if (!updated.rowCount) throw new Error('Run changed during reconciliation');
      await client.query('INSERT INTO experiment_events(experiment_id,payload) VALUES($1,$2)', [id, { type: 'run.classification_corrected', runId: run.id, ...correction }]);
    });
    corrections.push({ runId: run.id, ...correction });
  }
  const corrected = await store.exportExperiment(id);
  writeFileSync(resolve(directory, 'report-reconciled.json'), JSON.stringify({ ...corrected, reconciliation: { corrections, original: 'report-before-reconciliation.json', note: 'Classification repair only. No task, prompt, grader, action, or outcome was rerun or changed.' } }, null, 2));
  console.log(JSON.stringify({ correctedRuns: corrections.length, results: corrected.results }, null, 2));
} finally { await store.pool.end(); }
