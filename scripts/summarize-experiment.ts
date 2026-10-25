import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const path = process.argv[2];
if (!path) throw new Error('Supply an exported experiment JSON');
const report = JSON.parse(readFileSync(path, 'utf8'));
const runs = report.evidence.map((e: any) => e.run);
const usage = runs.map((r: any) => {
  const values = (r.runtime?.turns ?? []).map((t: any) => t.status?.usage).filter(Boolean);
  const field = (key: string) => values.map((v: any) => Number(v[key] ?? 0));
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  return { runId: r.id, reportedTurns: values.length, maxInput: Math.max(0, ...field('input_tokens')),
    sumInput: sum(field('input_tokens')), maxOutput: Math.max(0, ...field('output_tokens')), sumOutput: sum(field('output_tokens')) };
});
const total = (key: string) => usage.reduce((s: number, u: any) => s + u[key], 0);
const summary = {
  experimentId: report.experiment.id, status: report.experiment.status, results: report.results,
  totalTurns: runs.reduce((s: number, r: any) => s + (r.runtime?.turns?.length ?? 0), 0),
  usage: { reportedTurns: total('reportedTurns'), maxPerRunInputSummed: total('maxInput'), allTurnInputSummed: total('sumInput'),
    maxPerRunOutputSummed: total('maxOutput'), allTurnOutputSummed: total('sumOutput'),
    warning: 'Two accounting interpretations, not verified billing bounds. Usage may include cumulative counters; cache/retry semantics and invoice unknown.' },
  illustrativeBudget: { assumedInputUsdPerMillion: 1, assumedOutputUsdPerMillion: 4,
    maxPerRunInterpretationUsd: (total('maxInput') + 4 * total('maxOutput')) / 1e6,
    sumPerTurnInterpretationUsd: (total('sumInput') + 4 * total('sumOutput')) / 1e6,
    actualCostUsd: null, warning: 'Hypothetical arithmetic, NOT Copilot pricing or a billed-cost estimate.' },
  changedRuns: runs.filter((r: any) => r.task_snapshot.category === 'stale_slot').map((r: any) => ({
    runId: r.id, task: r.task_id, config: r.configuration_snapshot.name, status: r.status,
    grade: r.grade?.status, score: r.grade?.score, failedRules: r.grade?.assertions.filter((a: any) => a.status === 'fail').map((a: any) => a.rule),
    actions: r.final_state.events.filter((e: any) => e.type === 'tool' || e.type === 'lead').map((e: any) => ({ id: e.id, name: e.name, arguments: e.arguments, result: e.result })),
  })),
};
writeFileSync(resolve(dirname(path), 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, results: undefined, changedRuns: summary.changedRuns.map(({ actions, ...run }: any) => ({ ...run, actions: actions.map((a: any) => `${a.id}:${a.name}${a.result.error ? ':' + a.result.error : ''}`) })) }, null, 2));
