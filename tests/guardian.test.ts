import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

test('guardian tears down its isolated process group when the host pipe closes', { timeout: 10000 }, async () => {
  const guardian = spawn(process.execPath, ['--experimental-strip-types', resolve('packages/hermes/guardian.ts'), process.execPath, '-e', 'console.log("ready");setInterval(()=>{},1000)'], { detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => { guardian.stdout.once('data', () => resolve()); guardian.once('error', reject); });
  guardian.stdin.end();
  await new Promise<void>(resolve => guardian.once('exit', () => resolve()));
  await delay(100);
  assert.throws(() => process.kill(-guardian.pid!, 0), (error: any) => error.code === 'ESRCH');
});
