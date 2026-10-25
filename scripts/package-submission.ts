import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { submissionPaths } from './submission-paths.ts';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'output/submission'); mkdirSync(directory, { recursive: true });
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, COPYFILE_DISABLE: '1' }, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout.trim();
}
const sourceCommit = run('git', ['rev-parse', 'HEAD']);
const sourceBranch = run('git', ['symbolic-ref', 'HEAD']);
assert.equal(run('git', ['status', '--porcelain']), '', 'Commit the reviewed project before packaging');
const forbidden = /(^|\/)(?:\.env|\.eval-runtime|\.hermes-dev|node_modules|\.git|dist|leadloom|hermes-agent|hermes-capability-test)(?:\/|$)/;
const files: string[] = [];
function collect(path: string) {
  if (path.endsWith('/.DS_Store')) return;
  assert.ok(!forbidden.test(path), `Unexpected private/unrelated content: ${path}`);
  const stat = lstatSync(resolve(root, path));
  assert.ok(!stat.isSymbolicLink(), `Do not ship symlinks: ${path}`);
  if (stat.isDirectory()) for (const child of readdirSync(resolve(root, path)).sort()) collect(`${path}/${child}`);
  else files.push(path);
}
submissionPaths.forEach(collect);
assert.equal(new Set(files).size, files.length);
const secrets = /(?:gh[pousr]_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{30,}|sk-(?:proj-)?[a-zA-Z0-9_-]{30,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|Bearer\s+[a-zA-Z0-9_.-]{30,})/;
const hashes = files.map(path => {
  const bytes = readFileSync(resolve(root, path));
  if (/\.(?:ts|vue|json|md|sql|yml|css)$/.test(path)) assert.ok(!secrets.test(bytes.toString('utf8')), `Potential credential in ${path}; review without printing the value`);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
});
const bundle = 'output/submission/tracework-source.bundle';
run('git', ['bundle', 'create', resolve(root, bundle), 'HEAD', sourceBranch]);
run('git', ['bundle', 'verify', resolve(root, bundle)]);
const manifestPath = 'output/submission/PACKAGE-MANIFEST.json';
writeFileSync(resolve(root, manifestPath), JSON.stringify({ packagedAt: new Date().toISOString(), sourceCommit, sourceBranch,
  gitBundle: bundle, reviewCommand: 'npm run review', liveCommand: 'npm start',
  scope: 'Local take-home submission; saved real inference plus offline replay; limitations documented.',
  excluded: ['provider credentials', 'runtime profiles/logs', 'installed dependencies', 'external Hermes source', 'unrelated projects'],
  secretPatternScanPassed: true, files: hashes }, null, 2));
const checksumPaths = [...files, bundle, manifestPath];
const checksum = 'output/submission/CHECKSUMS.sha256';
writeFileSync(resolve(root, checksum), checksumPaths.map(path => `${createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')}  ${path}`).join('\n') + '\n');
const output = resolve(directory, 'tracework-submission.tar.gz');
run('tar', ['-czf', output, ...checksumPaths, checksum]);
const entries = run('tar', ['-tzf', output]).split('\n');
assert.equal(entries.length, checksumPaths.length + 1);
assert.ok(entries.every(path => !path.startsWith('/') && !path.split('/').includes('..') && !forbidden.test(path)));
writeFileSync(`${output}.sha256`, `${createHash('sha256').update(readFileSync(output)).digest('hex')}  tracework-submission.tar.gz\n`);
console.log(`Verified ${entries.length} source/evidence entries, source commit ${sourceCommit}, Git bundle and checksums: ${output}`);
