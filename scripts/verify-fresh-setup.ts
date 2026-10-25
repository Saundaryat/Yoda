import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { createServer } from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { submissionPaths } from './submission-paths.ts';

const root = resolve(import.meta.dirname, '..');
const directory = mkdtempSync(resolve(tmpdir(), 'tracework-fresh-'));
for (const path of submissionPaths) { const target = resolve(directory, path); mkdirSync(dirname(target), { recursive: true }); cpSync(resolve(root, path), target, { recursive: true }); }
assert.equal(existsSync(resolve(directory, 'node_modules')), false);
assert.equal(existsSync(resolve(directory, '.env')), false);
assert.equal(existsSync(resolve(directory, 'hermes-agent')), false);
const freePort = () => new Promise<number>((accept, reject) => {
  const server = createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const port = (server.address() as { port: number }).port; server.close(() => accept(port)); });
});
const port = await freePort(), dbPort = await freePort();
const project = `tracework-fresh-${Date.now()}`;
const env = { ...process.env, PORT: String(port), EVAL_DB_PORT: String(dbPort), COMPOSE_PROJECT_NAME: project,
  DATABASE_URL: `postgresql://evals:evals-local-only@127.0.0.1:${dbPort}/evals` };
// Review never invokes Hermes; do not borrow installed runtime credentials.
for (const key of Object.keys(env)) if (/^(?:OPENAI|ANTHROPIC|COPILOT|GITHUB|GH_|HERMES|EVAL_HERMES)/.test(key)) delete (env as Record<string, string | undefined>)[key];
delete (env as Record<string, string | undefined>).EVAL_SECRETS_FILE;
const logPath = resolve(directory, 'fresh-start.log');
const log = openSync(logPath, 'w');
let child = spawn('npm', ['run', 'review'], { cwd: directory, env, detached: true, stdio: ['ignore', log, log] });
closeSync(log);
async function stop() {
  if (!child.pid) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
  if (child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(accept => child.once('exit', accept)), delay(5000)]);
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
}
const evidence: Record<string, unknown> = { checkedAt: new Date().toISOString(), sourceCopy: directory, command: 'npm run review',
  noExistingDependencies: true, noEnvFile: true, noHermesCheckout: true, freshDockerProject: project, newInference: false };
try {
  let health: any;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (child.exitCode !== null) throw new Error(`Fresh startup exited ${child.exitCode}; inspect ${logPath}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { health = await response.json(); break; } } catch { /* Starting. */ }
    await delay(1000);
  }
  assert.equal(health?.readOnly, true, `Fresh review must become ready; inspect ${logPath}`);
  const base = `http://127.0.0.1:${port}`;
  const html = await (await fetch(base)).text(); assert.match(html, /Tracework/);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(asset);
  assert.equal((await fetch(`${base}${asset}`)).status, 200);
  const experiments = await (await fetch(`${base}/api/experiments`)).json(); assert.equal(experiments.length, 2);
  const primary = experiments.find((experiment: any) => experiment.snapshot.evidenceProvenance?.sourceExperimentId === '857ce98d-e957-4709-afd8-65f928828fb4');
  assert.ok(primary);
  const id = primary.id;
  const results = await (await fetch(`${base}/api/experiments/${id}/results`)).json();
  assert.deepEqual(results.configurations.map((config: any) => config.passed), [16, 18]);
  assert.equal(results.comparison.validPairs, 18);
  assert.equal((await fetch(`${base}/api/experiments/${id}/start`, { method: 'POST' })).status, 403);
  const checks = spawnSync('npm', ['test'], { cwd: directory, env, encoding: 'utf8' });
  assert.equal(checks.status, 0, checks.stdout.slice(-1500));
  Object.assign(evidence, { passed: true, health, suiteCount: (await (await fetch(`${base}/api/task-suites`)).json()).length,
    experimentId: id, runs: 40, validPairs: 18, passes: [16, 18], servedProductionAssets: true, writesBlocked: true,
    freshUnitTestsPassed: true, startupLog: logPath });
  await stop();
  const liveLog = openSync(logPath, 'a');
  child = spawn('npm', ['start'], { cwd: directory, env, detached: true, stdio: ['ignore', liveLog, liveLog] });
  closeSync(liveLog);
  let liveReady = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Live startup exited ${child.exitCode}; inspect ${logPath}`);
    try { const response = await fetch(`${base}/api/health`); if (response.ok && (await response.json()).readOnly === false) { liveReady = true; break; } } catch { /* Starting. */ }
    await delay(1000);
  }
  assert.ok(liveReady, 'npm start must serve the live application too');
  const suites = await (await fetch(`${base}/api/task-suites`)).json();
  const configs = await (await fetch(`${base}/api/configurations`)).json();
  const draftResponse = await fetch(`${base}/api/experiments`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId: suites[0].id, configurationIds: [configs[0].id], taskIds: [suites[0].definition.tasks[0].id], repetitions: 1 }) });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal((await fetch(`${base}/api/experiments/${draft.id}/cancel`, { method: 'POST' })).status, 201);
  assert.equal((await (await fetch(`${base}/api/experiments/${draft.id}`)).json()).status, 'cancelled');
  Object.assign(evidence, { liveStartupVerified: true, liveDraftCreatedAndCancelled: true, liveProviderExecutionTested: false });
  console.log(`Fresh review verified at ${base}; source ${directory}.`);
} catch (error) { evidence.passed = false; evidence.error = (error as Error).message; throw error; }
finally {
  await stop();
  const cleanup = spawnSync('docker', ['compose', 'down', '--volumes', '--remove-orphans'], { cwd: directory, env, encoding: 'utf8' });
  evidence.disposableDatabaseRemoved = cleanup.status === 0;
  mkdirSync(resolve(root, 'output/reliability'), { recursive: true });
  writeFileSync(resolve(root, 'output/reliability/fresh-setup.json'), JSON.stringify(evidence, null, 2));
}
