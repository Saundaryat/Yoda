import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const review = process.argv.includes('--review');
const databaseOverride = process.env.DATABASE_URL;
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const env = { ...process.env };
if (review) {
  env.EVAL_REVIEW_ONLY = '1';
  env.COMPOSE_PROJECT_NAME ??= 'tracework-review';
  env.EVAL_DB_PORT ??= '55434';
  env.DATABASE_URL = databaseOverride ?? `postgresql://evals:evals-local-only@127.0.0.1:${env.EVAL_DB_PORT}/evals`;
}
env.DATABASE_URL ??= `postgresql://evals:evals-local-only@127.0.0.1:${env.EVAL_DB_PORT ?? '55432'}/evals`;
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? result.status}`);
}
if (!existsSync(resolve(root, 'node_modules/tsx'))) run('npm', ['ci', '--ignore-scripts']);
run('docker', ['compose', 'up', '-d', '--wait', 'db']);
run('npm', ['run', 'build:web']);
const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'apps/api/main.ts'], { cwd: root, stdio: 'inherit', env });
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (!shuttingDown) { shuttingDown = true; child.kill(signal); }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? (shuttingDown ? 0 : 1); });
