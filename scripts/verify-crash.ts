import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const runId = `crash-probe-${randomUUID()}`;
const directory = resolve('.eval-runtime', runId); mkdirSync(directory, { recursive: true });
const checkpoint = resolve(directory, 'host.json');
const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/crash-host.ts', runId, checkpoint], { stdio: 'inherit', env: process.env });
let group: number | undefined;
function groupExists(id: number) {
  // macOS can return EPERM rather than ESRCH for a vanished process group.
  // Confirm using the OS process table instead of accepting EPERM as success.
  try { process.kill(-id, 0); return true; }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return execFileSync('ps', ['-axo', 'pgid='], { encoding: 'utf8' }).split('\n').some(line => Number(line.trim()) === id);
    throw error;
  }
}
try {
  let gatewayReady = false;
  for (let i = 0; i < 180; i++) {
    if (child.exitCode !== null) throw new Error('Crash host exited before the probe');
    try {
      const host = JSON.parse(readFileSync(checkpoint, 'utf8'));
      group = host.processGroupId;
      if (host.gatewayReady) { gatewayReady = true; break; }
    } catch { /* Startup has not created the first audit event yet. */ }
    await delay(1000);
  }
  assert.ok(group && gatewayReady);
  const start = Date.now();
  child.kill('SIGKILL');
  let removed = false;
  for (let i = 0; i < 40; i++) {
    if (!groupExists(group!)) { removed = true; break; }
    await delay(250);
  }
  assert.ok(removed, 'Guardian must remove the Hermes/MCP process group after host death');
  const dir = resolve('output/reliability'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'crash.json'), JSON.stringify({ checkedAt: new Date().toISOString(), runId, gatewayReady, observedModelAction: false, probeScope: 'Host death after real gateway readiness/toolset discovery, before inference; real mid-action cancellation is verified separately', cleanupMs: Date.now() - start, processGroupGone: removed, auditPreserved: true }, null, 2));
  console.log(`Real host-crash cleanup verified in ${Date.now() - start}ms; audit file preserved.`);
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  if (group && groupExists(group)) { try { process.kill(-group, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } }
}
