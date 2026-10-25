import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { liveCredentials } from '../packages/hermes/credentials.ts';

test('explicit external dotenv imports only the Anthropic key and does not mutate its source or caller', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eval-credentials-'));
  try {
    const file = join(directory, '.env');
    writeFileSync(file, 'ANTHROPIC_API_KEY="fixture-not-a-real-key"\nDATABASE_URL=other-app-db\nEVAL_PROVIDER=copilot\n');
    const original = { EVAL_SECRETS_FILE: file, DATABASE_URL: 'original-db', EVAL_PROVIDER: 'anthropic' };
    const env = liveCredentials(original);
    assert.equal(env.ANTHROPIC_API_KEY, 'fixture-not-a-real-key');
    assert.equal(env.DATABASE_URL, 'original-db');
    assert.equal(env.EVAL_PROVIDER, 'anthropic');
    assert.equal(Object.hasOwn(original, 'ANTHROPIC_API_KEY'), false);
    assert.equal(readFileSync(file, 'utf8'), 'ANTHROPIC_API_KEY="fixture-not-a-real-key"\nDATABASE_URL=other-app-db\nEVAL_PROVIDER=copilot\n');
  } finally { rmSync(directory, { recursive: true }); }
});

test('an explicit environment key takes precedence without reading a second credential file', () => {
  assert.equal(liveCredentials({ ANTHROPIC_API_KEY: 'explicit-fixture-key', EVAL_SECRETS_FILE: '/missing/file' }).ANTHROPIC_API_KEY, 'explicit-fixture-key');
});

test('credential-free read-only review never reads an external secrets file', () => {
  const env = liveCredentials({ EVAL_SECRETS_FILE: '/missing/file' }, true);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
});

test('a configured file without an Anthropic key produces an actionable setup error', () => {
  const directory = mkdtempSync(join(tmpdir(), 'eval-credentials-'));
  try {
    const file = join(directory, '.env'); writeFileSync(file, 'DATABASE_URL=other-app-db\n');
    assert.throws(() => liveCredentials({ EVAL_SECRETS_FILE: file }), /has no ANTHROPIC_API_KEY/);
  } finally { rmSync(directory, { recursive: true }); }
});
