import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { defaultDatabaseUrl } from '../apps/api/store.ts';

const url = process.env.DATABASE_URL ?? defaultDatabaseUrl;
const admin = new Pool({ connectionString: url });
const schema = `eval_test_startup_${randomUUID().replaceAll('-', '')}`;
await admin.query(`CREATE SCHEMA "${schema}"`);
const isolated = new URL(url); isolated.searchParams.set('options', `-c search_path=${schema}`);
const port = 3002;
const child = spawn(process.execPath, ['--experimental-strip-types', 'scripts/start.ts'], { detached: true, stdio: 'inherit', env: { ...process.env, PORT: String(port), DATABASE_URL: isolated.toString() } });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error(`Startup exited ${child.exitCode}`);
    try { const response = await fetch(`http://127.0.0.1:${port}/api/health`); if (response.ok) { ready = true; break; } } catch { /* Server is still building/starting. */ }
    await delay(1000);
  }
  assert.ok(ready, 'One-command startup must become ready');
  const html = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(html, /Tracework/);
  const asset = html.match(/src="([^"]+\.js)"/)?.[1]; assert.ok(asset);
  const script = await fetch(`http://127.0.0.1:${port}${asset}`);
  assert.equal(script.status, 200); assert.match(script.headers.get('content-type') ?? '', /javascript/);
  const suites = await (await fetch(`http://127.0.0.1:${port}/api/task-suites`)).json();
  assert.equal(suites.length, 2);
  console.log('Verified npm start: PostgreSQL readiness, Vue production HTML/assets, and real API on one origin.');
} finally {
  if (child.pid) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(6000)]);
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  }
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
