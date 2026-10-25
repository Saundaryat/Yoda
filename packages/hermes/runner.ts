import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { deliverLead, loadState, saveState } from '../../apps/crm-mcp/crm.ts';
import type { CrmState } from '../../apps/crm-mcp/crm.ts';
import { loadSampleSuite, prepareScenario, referenceInstructions } from '../contracts/tasks.ts';
import type { TaskDefinition, AgentConfiguration } from '../contracts/tasks.ts';
import { gradeRun } from '../eval-engine/graders.ts';
import { providerFailure } from './provider-errors.ts';

export interface ExecutionOptions {
  task?: TaskDefinition;
  configuration?: AgentConfiguration;
  runId?: string;
  signal?: AbortSignal;
  onReady?: () => Promise<void>;
  onCheckpoint?: (initial: CrmState, final: CrmState, runtime: Record<string, unknown>) => Promise<void>;
}
class AgentFailure extends Error {}
export async function runHermes(options: ExecutionOptions = {}) {
const root = resolve(import.meta.dirname, '../..');
const task = options.task ?? loadSampleSuite().tasks[0];
const runId = options.runId ?? `verification-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
if (!/^[a-zA-Z0-9_.-]+$/.test(runId)) throw new Error('Invalid run directory identifier');
const directory = join(root, '.eval-runtime', runId);
const home = join(directory, 'home');
const stateFile = join(directory, 'crm-state.json');
const logFile = join(directory, 'gateway.log');
const reportFile = join(directory, 'report.json');
const hermesRoot = resolve(process.env.EVAL_HERMES_ROOT ?? join(root, 'hermes-agent'));
const hermesBin = process.env.EVAL_HERMES_BIN ?? join(hermesRoot, '.hermes/bin/hermes');
const provider = options.configuration?.provider ?? process.env.EVAL_PROVIDER ?? 'copilot';
const model = options.configuration?.model ?? process.env.EVAL_MODEL ?? 'gpt-4.1';
const key = randomBytes(32).toString('hex');
mkdirSync(home, { recursive: true, mode: 0o700 });
writeFileSync(logFile, '', { mode: 0o600 });
const state = prepareScenario(task, runId);
const initialState = structuredClone(state);
const initial = state.events[0];
saveState(stateFile, state);

const instructions = options.configuration?.instructions ?? referenceInstructions;

const config = {
  model: { default: model, provider },
  fallback_providers: [],
  agent: { max_turns: 14, run_budget_seconds: 120, gateway_timeout: 150 },
  platform_toolsets: { api_server: ['mcp-eval-crm'], cli: ['mcp-eval-crm'] },
  memory: { memory_enabled: false, user_profile_enabled: false },
  auxiliary: { title_generation: { enabled: false }, background_review: { enabled: false } },
  curator: { enabled: false },
  telemetry: { shared_metrics: { enabled: false, send: false, offer_version: 2 } },
  mcp_servers: {
    'eval-crm': {
      command: process.execPath,
      args: ['--experimental-strip-types', join(root, 'apps/crm-mcp/server.ts')],
      env: { CRM_STATE_FILE: stateFile },
      supports_parallel_tool_calls: false,
      tools: { resources: false, prompts: false },
      trust: 'full',
    },
  },
};
writeFileSync(join(home, 'config.yaml'), JSON.stringify(config, null, 2), { mode: 0o600 });
writeFileSync(join(home, 'SOUL.md'), 'You are a concise appointment-setting assistant. Follow the business policy and verified tool results.\n', { mode: 0o600 });

const port = await new Promise<number>((accept, reject) => {
  const server = createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('Cannot allocate local port'));
    server.close(() => accept(address.port));
  });
});
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  HERMES_HOME: home,
  HERMES_RUNTIME_DIR: process.env.EVAL_HERMES_RUNTIME_DIR ?? join(hermesRoot, '.hermes-dev/tools'),
  API_SERVER_ENABLED: 'true', API_SERVER_HOST: '127.0.0.1', API_SERVER_PORT: String(port), API_SERVER_KEY: key,
  PYTHONUNBUFFERED: '1', GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1',
};
// Borrow the installed dependency interpreter, while keeping all agent state in a fresh home.
// This checkout's launcher otherwise looks for a new PM environment in every new home.
const installKey = createHash('sha256').update(hermesRoot).digest('hex').slice(0, 16);
const factsFile = join(hermesRoot, '.hermes-dev/installs', installKey, 'facts.json');
const selectedEnvironment = existsSync(factsFile)
  ? JSON.parse(readFileSync(factsFile, 'utf8')).packages?.venv?.environment as string | undefined : undefined;
const python = process.env.EVAL_HERMES_PYTHON ?? (selectedEnvironment ? join(selectedEnvironment, 'bin/python3') : undefined);
const command = process.env.EVAL_HERMES_BIN || !python ? hermesBin : python;
const commandArgs = command === hermesBin ? ['gateway'] : [
  '-I', '-c', 'import sys; sys.path.insert(0, sys.argv.pop(1)); from hermes_cli.main import main; sys.exit(main())', hermesRoot, 'gateway',
];
const gateway = spawn(process.execPath, ['--experimental-strip-types', join(root, 'packages/hermes/guardian.ts'), command, ...commandArgs], { cwd: directory, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
gateway.stdout.on('data', bytes => appendFileSync(logFile, bytes));
gateway.stderr.on('data', bytes => appendFileSync(logFile, bytes));
let spawnError: Error | undefined;
gateway.on('error', error => { spawnError = error; });
const sessionId = `eval-${randomUUID()}`;
const turns: Record<string, unknown>[] = [];
const lifecycleEvents: unknown[] = [];
let activeRunId: string | undefined;
let fatal: string | undefined;
let errorKind: 'infra_error' | 'agent_failed' | 'cancelled' | undefined;
let capabilities: unknown;
let toolsets: unknown;
const startedAt = new Date().toISOString();
let allRequestsIdempotent = true;

async function request(path: string, body?: unknown): Promise<Record<string, any>> {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return await response.json() as Record<string, any>;
}

async function captureEvents(id: string, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${base}/v1/runs/${id}/events`, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!response.ok || !response.body) throw new Error(`SSE HTTP ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value.replaceAll('\r\n', '\n');
    let boundary: number;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data && data !== '[DONE]') {
        let payload: unknown = data;
        try { payload = JSON.parse(data); } catch { /* Preserve a non-JSON event verbatim. */ }
        lifecycleEvents.push({ externalRunId: id, event: block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim(), data: payload });
      }
    }
  }
}

async function stopGateway(): Promise<void> {
  if (activeRunId) {
    try { await request(`/v1/runs/${activeRunId}/stop`, {}); }
    catch (error) { appendFileSync(logFile, `\nStop request: ${(error as Error).message}\n`); }
  }
  if (!gateway.pid) return;
  // This dedicated process group contains only this run's gateway and its MCP children.
  try { process.kill(-gateway.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  await Promise.race([new Promise<void>(accept => gateway.once('exit', () => accept())), delay(5000)]);
  try { process.kill(-gateway.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

try {
  await options.onCheckpoint?.(initialState, initialState, { turns, lifecycleEvents, sessionId, processGroupId: gateway.pid });
  console.log(`Starting isolated Hermes: ${provider}/${model}; run ${runId}`);
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    options.signal?.throwIfAborted();
    if (spawnError) throw spawnError;
    if (gateway.exitCode !== null) throw new Error(`Gateway exited (${gateway.exitCode}); inspect ${logFile}`);
    try { capabilities = await request('/v1/capabilities'); ready = true; break; }
    catch { await delay(1000); }
  }
  if (!ready) throw new Error(`Gateway not ready; inspect ${logFile}`);
  toolsets = await request('/v1/toolsets');
  writeFileSync(join(directory, 'toolsets.json'), JSON.stringify(toolsets, null, 2));
  await options.onReady?.();
  console.log('Hermes API ready; beginning scripted lead conversation.');
  let input = `Lead event ${initial.id}: ${initial.result.text}`;
  for (let turn = 1; turn <= task.limits.maxTurns; turn++) {
    options.signal?.throwIfAborted();
    const body = { input, session_id: sessionId, instructions, model, provider };
    const idempotencyKey = `${runId}-turn-${turn}`;
    const create = async () => {
      const response = await fetch(`${base}/v1/runs`, {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`Create run HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      return await response.json() as { run_id: string };
    };
    const created = await create();
    activeRunId = created.run_id;
    const replay = await create();
    allRequestsIdempotent &&= replay.run_id === activeRunId;
    if (!allRequestsIdempotent) throw new Error('Idempotent creation returned a different external run ID');
    console.log(`Turn ${turn}: ${activeRunId}`);
    const streamAbort = new AbortController();
    let streamError: string | undefined;
    const stream = captureEvents(activeRunId, streamAbort.signal).catch(error => {
      if (!streamAbort.signal.aborted) streamError = (error as Error).message;
    });
    const start = Date.now();
    let status: Record<string, any> = {};
    try {
      do {
        options.signal?.throwIfAborted();
        const providerError = providerFailure(readFileSync(logFile, 'utf8'));
        if (providerError) throw new Error(providerError);
        if (Date.now() - Date.parse(startedAt) > task.limits.timeoutMs) throw new AgentFailure('Scenario time budget exhausted');
        if (loadState(stateFile).events.filter(e => e.type === 'tool').length > task.limits.maxToolCalls) throw new AgentFailure('Scenario tool budget exhausted');
        status = await request(`/v1/runs/${activeRunId}`);
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(status.status)) break;
        if (['waiting_for_approval', 'unknown'].includes(status.status)) throw new Error(`Unexpected runtime state: ${status.status}`);
        if (Date.now() - start > 180000) throw new AgentFailure('Agent turn exceeded 180 second integration limit');
        await delay(500);
      } while (true);
      await Promise.race([stream, delay(1500)]);
    } finally {
      streamAbort.abort();
      await stream;
      turns.push({ turn, input, externalRunId: activeRunId, durationMs: Date.now() - start, status, streamError });
      await options.onCheckpoint?.(initialState, loadState(stateFile), { turns, lifecycleEvents, sessionId, processGroupId: gateway.pid });
    }
    activeRunId = undefined;
    if (status.status !== 'completed') {
      const message = `Hermes turn ${turn} ended ${status.status}: ${status.error ?? status.output ?? ''}`;
      if (/max_iterations|budget|turn.limit/.test(String(status.turn_exit_reason))) throw new AgentFailure(message);
      throw new Error(message);
    }
    if (streamError) throw new Error(`SSE capture failed: ${streamError}`);
    const current = loadState(stateFile);
    console.log(`Turn ${turn} completed; CRM stage=${current.scriptStep}; appointments=${current.appointments.length}`);
    if (current.scriptStep === 'complete') break;
    if (!current.pendingReply) throw new AgentFailure(`No scripted lead reply queued after turn ${turn}`);
    const reply = deliverLead(current, current.pendingReply);
    saveState(stateFile, current);
    input = `Lead event ${reply.id} (${reply.name}): ${reply.result.text}`;
  }
  if (loadState(stateFile).scriptStep !== 'complete') throw new AgentFailure('Scenario turn budget exhausted');
} catch (error) {
  fatal = (error as Error).message;
  errorKind = options.signal?.aborted ? 'cancelled' : error instanceof AgentFailure ? 'agent_failed' : 'infra_error';
} finally {
  await stopGateway();
  const finalState = loadState(stateFile);
  const grade = gradeRun(task, initialState, finalState);
  const warningLines = readFileSync(logFile, 'utf8').split('\n');
  const runtimeWarnings = {
    hermesRejectedMalformedToolCalls: warningLines.filter(line => line.includes('Tool tool_call returned error')).length,
    copilotTokenExchangeDegraded: warningLines.some(line => line.includes('exchange degraded to RAW token')),
  };
  const commit = execFileSync('git', ['-C', hermesRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const report = {
    schemaVersion: 1, runId, startedAt, completedAt: new Date().toISOString(),
    hermesCommit: commit, provider, requestedModel: model, sessionId,
    configuration: config, instructions, instructionsHash: createHash('sha256').update(instructions).digest('hex'),
    capabilities, turns, lifecycleEvents, initialState, finalState, task, grade, runtimeWarnings, processGroupId: gateway.pid,
    verification: { idempotentCreation: allRequestsIdempotent && turns.length > 0, multiTurnSession: turns.length >= 2, freshHermesHome: home, passed: !fatal && grade.status === 'passed' },
    error: fatal ?? null, errorKind: errorKind ?? null,
    limitations: ['Single scripted scenario; structured lead intents; human text/payload consistency is manually inspected', 'Local cancellation has a separate real-runtime probe; not all timing races are covered', 'No live profile reset/reuse probe; each execution uses a new home/process', 'Token costs remain unknown until provider billing rates are verified', 'Actual served runtime model/provider fields may be empty; requested settings are not independent proof of the served model', 'Hermes toolset discovery may omit enabled dynamic MCP entries; successful audited calls prove this CRM connection'],
  };
  writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
  if (report.verification.passed) {
    const exportDirectory = join(root, 'output/verification', runId);
    mkdirSync(exportDirectory, { recursive: true });
    writeFileSync(join(exportDirectory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(`Saved shareable evidence: ${join(exportDirectory, 'report.json')}`);
  }
  console.log(JSON.stringify({ passed: report.verification.passed, turns: turns.length, score: grade.score, gradeStatus: grade.status, error: report.error, reportFile }, null, 2));
  return report;
}
}
