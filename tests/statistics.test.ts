import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyze } from '../packages/eval-engine/statistics.ts';
import type { Observation } from '../packages/eval-engine/statistics.ts';
const plan = { configurationIds: ['a', 'b'], taskIds: ['t1', 't2', 't3', 't4'], repetitions: 3, experimentStatus: 'completed' };
function observations(): Observation[] {
  return plan.taskIds.flatMap((task_id, i) => ['a', 'b'].flatMap(configuration_id => [1, 2, 3].map(repetition => ({
    id: `${task_id}-${configuration_id}-${repetition}`, task_id, configuration_id, repetition, status: 'completed', task_snapshot: { category: 'test' }, runtime: null,
    grade: { version: 'v1', status: (configuration_id === 'b' || i === 3) ? 'passed' as const : 'failed' as const,
      score: configuration_id === 'b' ? 100 : i === 3 ? 100 : 60, hardFailures: [], dimensions: {}, assertions: [] },
  }))));
}
test('task-cluster bootstrap is reproducible, paired, and independent of input ordering', () => {
  const runs = observations();
  const result = analyze(runs, plan);
  assert.equal(result.comparison.passDifference, 0.75);
  assert.equal(result.comparison.validPairs, 12);
  assert.equal(result.comparison.taskClusters, 4);
  assert.equal(result.conclusion, 'better');
  assert.deepEqual(result.confidenceInterval, analyze([...runs].reverse(), plan).confidenceInterval);
  const duplicated = runs.flatMap(r => [r, { ...r, id: `${r.id}-repeat`, repetition: r.repetition + 3 }]);
  assert.deepEqual(analyze(duplicated, { ...plan, repetitions: 6 }).confidenceInterval, result.confidenceInterval);
});
test('incomplete pairs stay inconclusive with bounds and explicit exclusions', () => {
  const runs = observations(); runs[1].status = 'infra_error';
  const result = analyze(runs, plan);
  assert.equal(result.conclusion, 'inconclusive');
  assert.equal(result.comparison.validPairs, 11);
  assert.equal(result.configurations[0].valid, 11);
  assert.ok(result.comparison.missingOutcomeBounds);
});
test('constant observed effects do not imply certainty about unseen tasks', () => {
  const runs = observations().map(r => ({ ...r, grade: { ...r.grade!, status: 'passed' as const, score: 100 } }));
  const result = analyze(runs, plan);
  assert.equal(result.comparison.limitedVariation, true);
  assert.equal(result.conclusion, 'inconclusive');
});
test('new hard failures veto a candidate win and mismatched grader versions exclude pairs', () => {
  const runs = observations(); runs.find(r => r.configuration_id === 'b')!.grade!.hardFailures = ['consent'];
  assert.equal(analyze(runs, plan).conclusion, 'worse');
  runs[0].grade!.version = 'v0';
  assert.equal(analyze(runs, plan).comparison.validPairs, 11);
  assert.throws(() => analyze([...runs, runs[0]], plan), /Duplicate/);
});
