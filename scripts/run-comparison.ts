import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { defaultModel, defaultProvider, referenceInstructions } from '../packages/contracts/tasks.ts';

const base = process.env.EVAL_API_URL ?? 'http://127.0.0.1:3001/api';
async function request(path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return await response.json();
}
const suite = (await request('/task-suites')).find((s: any) => s.logical_id === 'clinic-evaluation');
if (!suite) throw new Error('Evaluation suite not seeded. Restart the API.');
const recovery = 'If a slot is rejected as unavailable, search again, offer an available alternative, obtain new consent, then retry.';
if (!referenceInstructions.includes(recovery)) throw new Error('Expected recovery instruction not found');
const common = { provider: process.env.EVAL_PROVIDER ?? defaultProvider, model: process.env.EVAL_MODEL ?? defaultModel, memoryEnabled: false };
const baseline = await request('/configurations', { ...common, name: 'A · Hand off after slot rejection', instructions: referenceInstructions.replace(recovery, 'If a slot is rejected as unavailable, escalate_to_human and stop. Do not search for or offer an alternative slot.') });
const candidate = await request('/configurations', { ...common, name: 'B · Recover and reconfirm', instructions: referenceInstructions });
const repetitions = Number(process.env.EVAL_REPETITIONS ?? 1);
const experiment = await request('/experiments', { suiteId: suite.id, configurationIds: [baseline.id, candidate.id], repetitions });
const id = experiment.id;
const directory = resolve('output/experiments', id);
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'protocol.json'), JSON.stringify({ frozenAt: new Date().toISOString(), experimentId: id, baselineId: baseline.id, candidateId: candidate.id, hypothesis: 'Recovery instructions improve stale-slot task outcomes; other categories are controls.', primaryMetric: 'macro task success B-A', repetitions, suiteHash: suite.content_hash, taskCount: suite.definition.tasks.length, note: 'Twenty cases share ten scenario families. One repetition is a budget-limited first experiment, not a reliability guarantee.' }, null, 2));
await request(`/experiments/${id}/start`, {});
console.log(`Comparison started: ${id}, ${suite.definition.tasks.length * repetitions * 2} real scenario runs.`);
let last = '';
while (true) {
  const current = await request(`/experiments/${id}`);
  const completed = current.runs.filter((r: any) => !['queued', 'running', 'grading'].includes(r.status)).length;
  const progress = `${completed}/${current.runs.length} ${current.status}`;
  if (last !== progress) { console.log(progress); last = progress; }
  if (['completed', 'failed', 'cancelled'].includes(current.status)) break;
  await delay(3000);
}
const report = await request(`/experiments/${id}/export`);
writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ experimentId: id, results: report.results, report: resolve(directory, 'report.json') }, null, 2));
