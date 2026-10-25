import type { Grade } from './graders.ts';

export const analysisVersion = 'paired-task-bootstrap-v1';
export interface Observation {
  id: string; task_id: string; configuration_id: string; repetition: number; status: string;
  grade: Grade | null; task_snapshot: { category: string };
  runtime: Record<string, any> | null;
}
export interface AnalysisPlan {
  configurationIds: string[]; taskIds: string[]; repetitions: number;
  experimentStatus: string; seed?: number; bootstrapSamples?: number; practicalThreshold?: number;
}
const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const valid = (r: Observation | undefined): r is Observation => !!r && ['completed', 'agent_failed'].includes(r.status)
  && !!r.grade && r.grade.status !== 'ungradable' && r.grade.score !== null;
const success = (r: Observation) => Number(r.status === 'completed' && r.grade?.status === 'passed');
const hard = (r: Observation) => Number(!!r.grade?.hardFailures.length);

export function analyze(runs: Observation[], plan: AnalysisPlan) {
  const seed = plan.seed ?? 74219;
  const samples = plan.bootstrapSamples ?? 10000;
  const threshold = plan.practicalThreshold ?? 0.05;
  if (samples < 100 || samples > 100000 || !Number.isInteger(samples)) throw new Error('Invalid bootstrap sample count');
  const lookup = new Map<string, Observation>();
  for (const run of runs) {
    const key = `${run.task_id}/${run.configuration_id}/${run.repetition}`;
    if (lookup.has(key)) throw new Error('Duplicate paired observation');
    lookup.set(key, run);
  }
  const configurations = plan.configurationIds.map(configurationId => {
    const selected = runs.filter(r => r.configuration_id === configurationId);
    const usable = selected.filter(valid);
    const taskValues = plan.taskIds.map(task => usable.filter(r => r.task_id === task)).filter(group => group.length);
    const duration = selected.map(r => (r.runtime?.turns as any[] | undefined)?.reduce((sum, turn) => sum + Number(turn.durationMs ?? 0), 0)).filter((v): v is number => v !== undefined);
    return {
      configurationId, planned: plan.taskIds.length * plan.repetitions, valid: usable.length,
      passed: usable.filter(r => success(r)).length,
      passRate: mean(taskValues.map(group => mean(group.map(success))!)),
      meanScore: mean(taskValues.map(group => mean(group.map(r => r.grade!.score!))!)),
      hardFailures: usable.filter(r => hard(r)).length, hardFailureRate: mean(taskValues.map(group => mean(group.map(hard))!)),
      meanLatencyMs: mean(duration),
      // Hermes reports raw turn usage; its accumulation semantics are not verified for this pin.
      usageStatus: 'raw_per_turn_available', estimatedCostUsd: null, costStatus: 'unknown',
    };
  });
  const taskComparisons = plan.taskIds.map(taskId => {
    const pairs: { a: Observation; b: Observation }[] = [];
    if (plan.configurationIds.length === 2) for (let rep = 1; rep <= plan.repetitions; rep++) {
      const a = lookup.get(`${taskId}/${plan.configurationIds[0]}/${rep}`);
      const b = lookup.get(`${taskId}/${plan.configurationIds[1]}/${rep}`);
      if (valid(a) && valid(b) && a.grade!.version === b.grade!.version) pairs.push({ a, b });
    }
    return { taskId, category: runs.find(r => r.task_id === taskId)?.task_snapshot.category ?? 'unknown',
      validPairs: pairs.length, plannedPairs: plan.repetitions,
      passDifference: mean(pairs.map(p => success(p.b) - success(p.a))),
      scoreDifference: mean(pairs.map(p => p.b.grade!.score! - p.a.grade!.score!)),
      hardFailureDifference: mean(pairs.map(p => hard(p.b) - hard(p.a))),
      newHardFailures: pairs.filter(p => hard(p.b) && !hard(p.a)).length,
    };
  });
  const paired = taskComparisons.filter(t => t.validPairs > 0);
  const complete = plan.configurationIds.length === 2 && taskComparisons.every(t => t.validPairs === plan.repetitions)
    && plan.experimentStatus === 'completed';
  const difference = mean(paired.map(t => t.passDifference!));
  const scoreDifference = mean(paired.map(t => t.scoreDifference!));
  const hardDifference = mean(paired.map(t => t.hardFailureDifference!));
  const interval = paired.length >= 2 ? bootstrap(paired.map(t => t.passDifference!), seed, samples) : null;
  const scoreInterval = paired.length >= 2 ? bootstrap(paired.map(t => t.scoreDifference!), seed, samples) : null;
  const limitedVariation = paired.length > 0 && new Set(paired.map(t => t.passDifference)).size === 1;
  // For each missing repetition, bound an unknown B-A success difference by [-1,+1].
  const missingBounds = plan.configurationIds.length === 2 ? [-1, 1].map(bound => mean(taskComparisons.map(task =>
    ((task.passDifference ?? 0) * task.validPairs + bound * (plan.repetitions - task.validPairs)) / plan.repetitions))) : null;
  let conclusion = plan.configurationIds.length === 2 ? 'inconclusive' : 'descriptive_only';
  if (complete && interval && !limitedVariation) {
    if (paired.some(t => t.newHardFailures > 0) || interval[1] < -threshold) conclusion = 'worse';
    else if (interval[0] > threshold && (hardDifference ?? 1) <= 0) conclusion = 'better';
    else if (interval[0] >= -threshold && interval[1] <= threshold && (hardDifference ?? 1) <= 0) conclusion = 'similar_within_tolerance';
  }
  if (complete && paired.some(t => t.newHardFailures > 0)) conclusion = 'worse';
  return { analysisVersion, configurations, conclusion, confidenceInterval: interval,
    comparison: { baselineId: plan.configurationIds[0] ?? null, candidateId: plan.configurationIds[1] ?? null,
      passDifference: difference, scoreDifference, scoreConfidenceInterval: scoreInterval, hardFailureDifference: hardDifference,
      complete, plannedPairs: plan.taskIds.length * plan.repetitions, validPairs: paired.reduce((sum, t) => sum + t.validPairs, 0),
      taskClusters: paired.length, missingOutcomeBounds: missingBounds, seed, bootstrapSamples: samples,
      practicalThreshold: threshold, limitedVariation, confidenceLevel: 0.95 },
    taskComparisons,
    categories: [...new Set(taskComparisons.map(t => t.category))].map(category => {
      const tasks = taskComparisons.filter(t => t.category === category);
      return { category, tasks: tasks.length, passDifference: mean(tasks.filter(t => t.validPairs).map(t => t.passDifference!)), scoreDifference: mean(tasks.filter(t => t.validPairs).map(t => t.scoreDifference!)) };
    }),
    coverage: Object.fromEntries([...new Set(runs.map(r => r.status))].map(status => [status, runs.filter(r => r.status === status).length])),
    note: 'Paired bootstrap resamples whole task clusters, preserving repetitions. Handcrafted suite evidence only; missing runs, limited variation, and small task counts limit conclusions. Costs remain unknown.',
  };
}
function bootstrap(differences: number[], seed: number, samples: number): [number, number] {
  let state = seed >>> 0;
  const random = () => { state += 0x6d2b79f5; let v = state; v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296; };
  const draws: number[] = [];
  for (let i = 0; i < samples; i++) {
    let sum = 0;
    for (let t = 0; t < differences.length; t++) sum += differences[Math.floor(random() * differences.length)];
    draws.push(sum / differences.length);
  }
  draws.sort((a, b) => a - b);
  return [draws[Math.floor((samples - 1) * 0.025)], draws[Math.floor((samples - 1) * 0.975)]];
}
