import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerFailure } from '../packages/hermes/provider-errors.ts';
test('provider retry evidence is infrastructure, not slow-agent failure', () => {
  assert.match(providerFailure('API call failed error_type=RateLimitError; Retrying in 600s')!, /Provider rate limited/);
  assert.match(providerFailure('openai.RateLimitError: exceeded utility model quota')!, /429/);
  assert.equal(providerFailure('Agent turn exceeded 180 second integration limit'), null);
  assert.equal(providerFailure('Lead text: I have 429 questions'), null);
});
