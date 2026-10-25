import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gradeRun, graderVersion } from '../packages/eval-engine/graders.ts';
import { analyze } from '../packages/eval-engine/statistics.ts';

const path = process.argv[2];
if (!path) throw new Error('Usage: node --import tsx scripts/regrade-backend.ts output/backend/<experiment-id>/report.json');
const sourceBytes = readFileSync(resolve(path));
const report = JSON.parse(sourceBytes.toString('utf8'));
const changedVersion = report.evidence.some(({ run }: any) => run.grade && run.grade.version !== graderVersion);
if (changedVersion && !process.argv.includes('--allow-new-version')) throw new Error('Grader version changed. Use --allow-new-version to save a separate regrade; the original report is preserved.');
const records = report.evidence.map(({ run }: any) => {
  if (!run.grade) return { taskId: run.task_id, runId: run.id, skipped: true, reason: run.status };
  const grade = gradeRun(run.task_snapshot, run.initial_state, run.final_state);
  if (!changedVersion) assert.deepEqual(grade, run.grade, `${run.task_id}: persisted assertions or evidence differ from replay`);
  return { taskId: run.task_id, runId: run.id, previousVersion: run.grade?.version, previousStatus: run.grade?.status,
    previousScore: run.grade?.score, configurationId: run.configuration_id, configuration: run.configuration_snapshot.name,
    executionStatus: run.status, previousHardFailures: run.grade?.hardFailures,
    assertionChanges: grade.assertions.flatMap(assertion => {
      const previous = run.grade.assertions.find((item: any) => item.rule === assertion.rule);
      return previous && (previous.status !== assertion.status || !isDeepStrictEqual(previous.actual, assertion.actual))
        ? [{ rule: assertion.rule, previousStatus: previous.status, status: assertion.status, previousActual: previous.actual, actual: assertion.actual }]
        : [];
    }), ...grade };
});
const grades = new Map(records.filter((r: any) => !r.skipped).map((r: any) => [r.runId, r]));
const frozen = report.experiment.snapshot;
const results = analyze(report.evidence.map(({ run }: any) => ({ ...run, grade: grades.get(run.id) ?? null })), {
  configurationIds: frozen.configurations.map((config: any) => config.id), taskIds: frozen.taskIds,
  repetitions: frozen.repetitions, experimentStatus: report.experiment.status,
  seed: frozen.analysisSeed, practicalThreshold: frozen.practicalThreshold,
});
const output = resolve(dirname(path), `regrade-${graderVersion}.json`);
assert.deepEqual(readFileSync(resolve(path)), sourceBytes, 'Historical export must remain unchanged');
writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), sourceReport: resolve(path),
  sourceReportSha256: createHash('sha256').update(sourceBytes).digest('hex'),
  implementationHashes: Object.fromEntries(['packages/eval-engine/graders.ts', 'packages/eval-engine/content.ts', 'packages/eval-engine/statistics.ts'].map(file =>
    [file, createHash('sha256').update(readFileSync(resolve(import.meta.dirname, '..', file))).digest('hex')])),
  kind: 'offline-regrade-no-new-inference', validationPassed: true, changedVersion, records, results }, null, 2));
console.log(`${changedVersion ? 'Regraded' : 'Reproduced'} ${records.filter((r: any) => !r.skipped).length} graded runs; ${records.filter((r: any) => r.skipped).length} excluded infrastructure/cancelled records: ${output}`);
