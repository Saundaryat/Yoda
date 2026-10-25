import assert from 'node:assert/strict';
import { test } from 'node:test';
import { discoverReadyToolsets } from '../packages/hermes/readiness.ts';

test('tool discovery waits through transient registry initialization before any agent turn', async () => {
  let calls = 0, pauses = 0;
  const result = await discoverReadyToolsets(async path => {
    assert.equal(path, '/v1/toolsets');
    if (++calls < 3) throw new Error('/v1/toolsets: HTTP 500: Failed to enumerate toolsets');
    return { tools: ['mcp-eval-crm'] };
  }, async () => { pauses++; });
  assert.equal(result.attempts, 3);
  assert.equal(pauses, 2);
  assert.deepEqual(result.toolsets, { tools: ['mcp-eval-crm'] });
});

test('a persistent startup error is bounded to five read-only attempts', async () => {
  let calls = 0;
  await assert.rejects(discoverReadyToolsets(async () => { calls++; throw new Error('/v1/toolsets: HTTP 500: persistent failure'); }, async () => {}), /persistent failure/);
  assert.equal(calls, 5);
});

test('a toolset enumeration timeout can recover before any model request is made', async () => {
  let calls = 0;
  const result = await discoverReadyToolsets(async () => {
    if (++calls === 1) throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    return { ready: true };
  }, async () => {});
  assert.equal(result.attempts, 2);
});

for (const message of ['/v1/toolsets: HTTP 401: Unauthorized', '/v1/toolsets: HTTP 429: Rate limited', '/v1/runs: HTTP 500: Agent failure']) test(`startup retry cannot hide other failures: ${message}`, async () => {
  let calls = 0;
  await assert.rejects(discoverReadyToolsets(async () => { calls++; throw new Error(message); }, async () => {}), error => error instanceof Error && error.message === message);
  assert.equal(calls, 1);
});
