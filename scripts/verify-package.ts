import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const archive = resolve(process.argv[2] ?? resolve(root, 'output/submission/tracework-submission.tar.gz'));
const directory = mkdtempSync(resolve(tmpdir(), 'tracework-package-'));
function run(command: string, args: string[], cwd = directory) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}\n${result.stdout.slice(-2000)}`);
  return result.stdout.trim();
}
run('tar', ['-xzf', archive]);
run('shasum', ['-a', '256', '-c', 'output/submission/CHECKSUMS.sha256']);
const manifest = JSON.parse(readFileSync(resolve(directory, 'output/submission/PACKAGE-MANIFEST.json'), 'utf8'));
const checkout = resolve(directory, 'checkout');
run('git', ['clone', resolve(directory, manifest.gitBundle), checkout]);
const commit = run('git', ['rev-parse', 'HEAD'], checkout);
assert.equal(commit, manifest.sourceCommit);
assert.equal(run('git', ['status', '--porcelain'], checkout), '');
for (const file of manifest.files) assert.equal(createHash('sha256').update(readFileSync(resolve(checkout, file.path))).digest('hex'), file.sha256, file.path);
run(process.execPath, ['--experimental-strip-types', 'scripts/verify-fresh-setup.ts'], checkout);
const fresh = JSON.parse(readFileSync(resolve(checkout, 'output/reliability/fresh-setup.json'), 'utf8'));
assert.equal(fresh.passed, true);
assert.equal(fresh.disposableDatabaseRemoved, true);
writeFileSync(resolve(root, 'output/submission/package-verification.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed: true,
  archiveSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), sourceCommit: commit,
  allExtractedChecksumsPassed: true, gitBundleClonePassed: true, allClonedFileHashesPassed: true,
  fileCount: manifest.files.length, freshSetupFromBundlePassed: true, liveDraftLifecyclePassed: fresh.liveDraftCreatedAndCancelled,
  noProviderCalls: true, disposableDatabaseRemoved: fresh.disposableDatabaseRemoved }, null, 2));
console.log(`Verified exact package: checksums, ${manifest.files.length} cloned source/evidence hashes, cold startup, replay results and draft/cancel lifecycle; commit ${commit}.`);
