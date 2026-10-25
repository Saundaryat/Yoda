import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createEvaluationApp } from '../apps/api/app.ts';
import { consentWorkflowInstructions, consentWorkflowRevision, withConsentWorkflow, reliableWorkflowInstructions, reliableWorkflowRevision, slotOfferInstructions, withAlignedSlotOffers, withReliableWorkflow } from '../packages/contracts/tasks.ts';
import { graderVersion } from '../packages/eval-engine/graders.ts';

// A real rerun. Historical task/configuration snapshots are inputs,
// never edited; common instruction amendments are explicit in the new protocol.
const [sourceArgument, selection, ...flags] = process.argv.slice(2);
if (!sourceArgument || !selection || flags.some(flag => flag !== '--reliable-workflow' && flag !== '--consent-workflow' && !flag.startsWith('--provider=') && !flag.startsWith('--model='))) throw new Error('Usage: node --import tsx scripts/rerun-task.ts <source-export.json> <task-id[,task-id...]|--full-suite> [--reliable-workflow] [--consent-workflow] [--provider=... --model=...]');
const reliableWorkflow = flags.includes('--reliable-workflow');
const consentWorkflow = flags.includes('--consent-workflow');
const providerOverride = flags.find(flag => flag.startsWith('--provider='))?.slice('--provider='.length);
const modelOverride = flags.find(flag => flag.startsWith('--model='))?.slice('--model='.length);
assert.equal(Boolean(providerOverride), Boolean(modelOverride), 'Override provider and model together for both configurations');
const fullSuite = selection === '--full-suite';
const sourcePath = resolve(sourceArgument);
const sourceBytes = readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const frozen = source.experiment.snapshot;
assert.equal(frozen.configurations.length, 2, 'Expected the original A/B comparison');
const requested = selection.split(',');
const tasks = fullSuite ? frozen.suite.definition.tasks : frozen.suite.definition.tasks.filter((item: any) => requested.includes(item.id));
assert.ok(tasks.length && (fullSuite || requested.length === new Set(requested).size && tasks.length === requested.length && requested.every(id => frozen.taskIds.includes(id))), 'Tasks must be unique and belong to the source experiment');
const taskIds = tasks.map((task: any) => task.id);
const kind = fullSuite ? 'real-hermes-full-suite-rerun' : 'real-hermes-targeted-rerun';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const hermesRoot = resolve(process.env.EVAL_HERMES_ROOT ?? 'hermes-agent');
const runtimeFactsPath = resolve(hermesRoot, '.hermes-dev/installs', hash(hermesRoot).slice(0, 16), 'facts.json');
const selectedEnvironment = existsSync(runtimeFactsPath) ? JSON.parse(readFileSync(runtimeFactsPath, 'utf8')).packages?.venv?.environment : undefined;
const runtimePython = process.env.EVAL_HERMES_PYTHON ?? (selectedEnvironment ? resolve(selectedEnvironment, 'bin/python3') : undefined);
const needsAnthropic = frozen.configurations.some((config: any) => (providerOverride ?? config.definition.provider) === 'anthropic');
// Validate the optional native SDK before creating forty runs, rather than
// discovering the same installation failure independently in every scenario.
const anthropicSdkVersion = needsAnthropic && runtimePython ? execFileSync(runtimePython,
  ['-c', 'import anthropic; print(anthropic.__version__)'], { encoding: 'utf8' }).trim() : null;
const app = await createEvaluationApp({ logger: false });
try {
  await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const request = async (path: string, body?: unknown): Promise<any> => {
    const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  };
  assert.equal((await request('/health')).executor, 'hermes');
  const suite = await request('/task-suites', frozen.suite.definition);
  const configurations = [];
  for (const original of frozen.configurations) {
    const alreadyAligned = original.definition.instructions.includes(slotOfferInstructions);
    const aligned = withAlignedSlotOffers(original.definition.instructions);
    const revised = reliableWorkflow && !aligned.includes(reliableWorkflowInstructions);
    const rerouted = Boolean(providerOverride && (providerOverride !== original.definition.provider || modelOverride !== original.definition.model));
    const workflow = reliableWorkflow ? withReliableWorkflow(aligned) : aligned;
    const consentRevised = consentWorkflow && !workflow.includes(consentWorkflowInstructions);
    const instructions = consentWorkflow ? withConsentWorkflow(workflow) : workflow;
    const definition = { ...original.definition,
      provider: providerOverride ?? original.definition.provider, model: modelOverride ?? original.definition.model,
      name: `${alreadyAligned ? original.definition.name : `${original.definition.name} · aligned offers v1`}${revised ? ` · ${reliableWorkflowRevision}` : ''}${rerouted ? ` · ${providerOverride}` : ''}${consentRevised ? ` · ${consentWorkflowRevision}` : ''}`,
      instructions };
    assert.equal(definition.instructions, `${aligned}${revised ? `\n${reliableWorkflowInstructions}` : ''}${consentRevised ? `\n${consentWorkflowInstructions}` : ''}`,
      'Rerun must apply only the declared common amendments');
    const saved = await request('/configurations', definition);
    if (alreadyAligned && !revised && !rerouted && !consentRevised) assert.equal(saved.content_hash, original.content_hash, 'Unchanged configuration must retain its hash');
    configurations.push(saved);
  }
  const experiment = await request('/experiments', { suiteId: suite.id, configurationIds: configurations.map(c => c.id), repetitions: 1, taskIds });
  const directory = resolve('output/experiments', experiment.id);
  mkdirSync(directory, { recursive: true });
  const protocol = {
    frozenAt: new Date().toISOString(), experimentId: experiment.id, kind,
    sourceExperimentId: source.experiment.id, sourceReport: sourcePath, sourceReportSha256: hash(sourceBytes),
    taskIds, repetitions: 1, plannedRuns: tasks.length * configurations.length, graderVersion,
    commonInstructionAmendment: slotOfferInstructions,
    workflowInstructionAmendment: reliableWorkflow ? { revision: reliableWorkflowRevision, instructions: reliableWorkflowInstructions } : null,
    consentInstructionAmendment: consentWorkflow ? { revision: consentWorkflowRevision, instructions: consentWorkflowInstructions } : null,
    providerRoutingOverride: providerOverride ? { provider: providerOverride, model: modelOverride, appliedToBothConfigurations: true, poolWithSourceResults: false } : null,
    runtimeDependencies: { anthropicSdkVersion, installation: anthropicSdkVersion ? 'Hermes PM declared anthropic extra' : null },
    configurations: configurations.map((config, index) => ({ ...config, sourceConfigurationId: frozen.configurations[index].id })),
    suiteHash: suite.content_hash, tasks,
    executionOrder: (await request(`/experiments/${experiment.id}`)).runs.map((run: any) => ({ runId: run.id, taskId: run.task_id, configurationId: run.configuration_id })),
    hermesCommit: execFileSync('git', ['-C', resolve(process.env.EVAL_HERMES_ROOT ?? 'hermes-agent'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    implementationHashes: Object.fromEntries(['apps/crm-mcp/crm.ts', 'apps/crm-mcp/server.ts', 'packages/contracts/tasks.ts', 'packages/eval-engine/content.ts', 'packages/eval-engine/graders.ts', 'packages/hermes/runner.ts'].map(path => [path, hash(readFileSync(path))])),
    hypothesis: consentWorkflow
      ? 'Both configurations must obtain a later, slot-specific USER consent event before any booking attempt and deliver a new offer_slots confirmation question after Maybe. Their distinct stale-slot recovery behavior is unchanged. This is fresh inference with a common prompt/tool-guidance revision; original failed attempts remain failures.'
      : reliableWorkflow
      ? 'Both configurations should align offered slots and follow booking-evidence, suppression and CRM-delivery rules. A retains handoff after stale-slot rejection; B retains re-search/reconfirmation recovery. This is a new prompt revision, not an offline regrade.'
      : 'Both configurations should produce slot offers whose text and slotIds agree. A retains its deliberate handoff after a stale-slot rejection; B retains re-search/reconfirmation recovery.',
    primaryMetric: 'macro task success B-A', practicalThreshold: experiment.snapshot.practicalThreshold,
    analysisSeed: experiment.snapshot.analysisSeed, analysisVersion: experiment.snapshot.analysisVersion,
    bootstrapSamples: 10000,
    limitations: [fullSuite ? 'Twenty handcrafted tasks share ten scenario families, with one repetition per configuration; this is limited suite-based evidence.' : `${tasks.length} tasks with one repetition per configuration are targeted regression checks, not a new full-suite performance estimate.`, providerOverride ? 'Provider/model are explicitly overridden for both configurations. Do not pool with source-provider results; served metadata may remain unavailable.' : 'Provider/model are inherited from the original snapshots; served metadata may remain unavailable.'],
  };
  writeFileSync(resolve(directory, 'protocol.json'), JSON.stringify(protocol, null, 2));
  await request(`/experiments/${experiment.id}/start`, {});
  console.log(`Real experiment ${experiment.id}: ${tasks.length} tasks, ${tasks.length * configurations.length} scenarios; ${directory}`);
  const deadline = Date.now() + configurations.length * tasks.reduce((sum: number, task: any) => sum + task.limits.timeoutMs + 120000, 0);
  let last = '';
  let savedCount = -1;
  while (true) {
    const current = await request(`/experiments/${experiment.id}`);
    const finished = current.runs.filter((run: any) => !['queued', 'running', 'grading'].includes(run.status));
    const active = current.runs.find((run: any) => ['running', 'grading'].includes(run.status));
    const latest = finished.at(-1);
    const progress = `${finished.length}/${current.runs.length} finished; ${current.status}; active: ${active ? `${active.task_id} / ${active.configuration_snapshot.name}` : 'none'}; latest: ${latest ? `${latest.task_id} ${latest.status}/${latest.grade?.status ?? 'no grade'}` : 'none'}`;
    if (progress !== last) {
      console.log(progress); last = progress;
      writeFileSync(resolve(directory, 'progress.json'), JSON.stringify({ recordedAt: new Date().toISOString(), experimentId: experiment.id, status: current.status,
        completed: finished.length, planned: current.runs.length,
        active: active ? { runId: active.id, taskId: active.task_id, configuration: active.configuration_snapshot.name } : null,
        runs: current.runs.map((run: any) => ({ runId: run.id, taskId: run.task_id, configuration: run.configuration_snapshot.name, status: run.status, grade: run.grade?.status ?? null, score: run.grade?.score ?? null, error: run.error })),
      }, null, 2));
    }
    if (finished.length > savedCount) {
      const checkpoint = await request(`/experiments/${experiment.id}/export`);
      writeFileSync(resolve(directory, 'report-progress.json'), JSON.stringify(checkpoint, null, 2));
      savedCount = finished.length;
    }
    if (['completed', 'failed', 'cancelled'].includes(current.status)) break;
    if (Date.now() > deadline) { await request(`/experiments/${experiment.id}/cancel`, {}); break; }
    await delay(1000);
  }
  // Cancellation can return before the isolated gateway has fully stopped.
  // Wait for its checkpoint before saving the terminal export.
  let report = await request(`/experiments/${experiment.id}/export`);
  if (report.experiment.runs.some((run: any) => ['running', 'grading'].includes(run.status))) {
    for (let i = 0; i < 45; i++) {
      await delay(1000);
      report = await request(`/experiments/${experiment.id}/export`);
      if (!report.experiment.runs.some((run: any) => ['running', 'grading'].includes(run.status))) break;
    }
  }
  assert.equal(hash(readFileSync(sourcePath)), protocol.sourceReportSha256, 'Historical source report changed');
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
  const summary = {
    experimentId: experiment.id, sourceExperimentId: source.experiment.id, taskIds, status: report.experiment.status,
    graderVersion, kind,
    runs: report.evidence.map(({ run }: any) => ({ runId: run.id, taskId: run.task_id, configuration: run.configuration_snapshot.name,
      status: run.status, grade: run.grade?.status ?? null, score: run.grade?.score ?? null, error: run.error,
      failedRules: run.grade?.assertions.filter((a: any) => a.status === 'fail').map((a: any) => ({ rule: a.rule, actual: a.actual, evidence: a.evidence })) ?? [],
      offers: run.final_state?.events.filter((e: any) => e.name === 'send_message' && e.arguments.intent === 'offer_slots').map((e: any) => ({ eventId: e.id, text: e.arguments.text, slotIds: e.arguments.slotIds, result: e.result })),
      appointments: run.final_state?.appointments ?? [],
    })),
    results: report.results, limitations: protocol.limitations,
  };
  writeFileSync(resolve(directory, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ experimentId: experiment.id, status: summary.status, counts: summary.runs.reduce((counts: Record<string, number>, run: any) => { const key = run.grade ?? run.status; counts[key] = (counts[key] ?? 0) + 1; return counts; }, {}), results: report.results }, null, 2));
  console.log(`Saved immutable rerun: ${resolve(directory, 'report.json')}`);
} finally { await app.close(); }
