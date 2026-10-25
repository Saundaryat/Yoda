import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gradeRun, graderVersion } from '../../packages/eval-engine/graders.ts';
import { Store } from './store.ts';

export const savedEvidenceDirectory = 'output/experiments/857ce98d-e957-4709-afd8-65f928828fb4';
// A terminal, independently identified review copy. Source files and their
// recorded behavior stay unchanged; this never queues model execution.
export async function loadSavedEvidence(store: Store, directory = resolve(savedEvidenceDirectory)): Promise<string> {
  const sourceBytes = readFileSync(resolve(directory, 'report.json'));
  const source = JSON.parse(sourceBytes.toString('utf8'));
  const regrade = JSON.parse(readFileSync(resolve(directory, `regrade-${graderVersion}.json`), 'utf8'));
  const hash = createHash('sha256').update(sourceBytes).digest('hex');
  assert.equal(hash, regrade.sourceReportSha256, 'Regrade source hash must match the saved real export');
  assert.ok(['completed', 'failed', 'cancelled'].includes(source.experiment.status), 'Only terminal evidence may be loaded');
  const existing = await store.pool.query("SELECT id FROM experiments WHERE snapshot->'evidenceProvenance'->>'sourceReportSha256'=$1 AND snapshot->>'graderVersion'=$2", [hash, graderVersion]);
  if (existing.rowCount) return existing.rows[0].id;
  const grades = new Map(regrade.records.map((record: any) => [record.runId, record]));
  assert.equal(source.evidence.length, source.experiment.snapshot.plannedRuns);
  assert.equal(new Set(source.evidence.map(({ run }: any) => run.id)).size, source.evidence.length);
  for (const { run } of source.evidence) {
    assert.ok(['completed', 'agent_failed', 'infra_error', 'cancelled', 'ungradable'].includes(run.status));
    const record: any = grades.get(run.id);
    assert.ok(record, 'Every run needs a replay record');
    if (run.grade) {
      const expected = Object.fromEntries(['version', 'status', 'score', 'hardFailures', 'dimensions', 'assertions'].map(key => [key, record[key]]));
      assert.deepEqual(gradeRun(run.task_snapshot, run.initial_state, run.final_state), expected, 'Replay must match the current grader');
    } else assert.equal(record.skipped, true);
  }
  const frozen = source.experiment.snapshot;
  const suite = await store.importSuite(frozen.suite.definition);
  const configurations = await Promise.all(frozen.configurations.map((config: any) => store.createConfiguration(config.definition)));
  const configurationIds = new Map(frozen.configurations.map((config: any, index: number) => [config.id, configurations[index].id]));
  const id = randomUUID();
  await store.transaction(async client => {
    await client.query('INSERT INTO experiments(id,status,snapshot,completed_at) VALUES($1,$2,$3,now())', [id, source.experiment.status, {
      ...frozen, suite, configurations, graderVersion, executor: 'saved-evidence',
      evidenceProvenance: { kind: 'saved-real-inference-offline-regrade', sourceExperimentId: source.experiment.id,
        sourceReportSha256: hash, sourceCreatedAt: source.experiment.created_at, originalGraderVersion: frozen.graderVersion,
        replayGraderVersion: graderVersion, newInference: false, sourceWorkflowRevision: 'reliable-workflow-v1' },
    }]);
    for (const { run, events } of source.evidence) {
      const runId = randomUUID();
      const replay: any = grades.get(run.id);
      const grade = run.grade ? Object.fromEntries(['version', 'status', 'score', 'hardFailures', 'dimensions', 'assertions'].map(key => [key, replay[key]])) : null;
      await client.query('INSERT INTO runs(id,experiment_id,task_id,configuration_id,repetition,execution_order,status,task_snapshot,configuration_snapshot,initial_state,final_state,runtime,grade,error,started_at,completed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
        [runId, id, run.task_id, configurationIds.get(run.configuration_id), run.repetition, run.execution_order, run.status,
          run.task_snapshot, run.configuration_snapshot, run.initial_state, run.final_state, { ...run.runtime, sourceRunId: run.id, importedReviewCopy: true }, grade, run.error, run.started_at, run.completed_at]);
      for (const event of events) await client.query('INSERT INTO run_events(run_id,source,event_id,sequence,payload) VALUES($1,$2,$3,$4,$5)', [runId, event.source, event.event_id, event.sequence, event.payload]);
      for (const assertion of grade?.assertions ?? []) await client.query('INSERT INTO assertion_results(run_id,rule,status,payload) VALUES($1,$2,$3,$4)', [runId, assertion.rule, assertion.status, assertion]);
    }
    await client.query('INSERT INTO experiment_events(experiment_id,payload) VALUES($1,$2)', [id,
      { type: 'evidence.imported', sourceExperimentId: source.experiment.id, newInference: false, graderVersion }]);
  });
  return id;
}
