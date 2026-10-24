import Anthropic from '@anthropic-ai/sdk';
import { InfraError } from './hermes-cli.js';

/**
 * Claude is used twice outside the agent under test: to play the lead and to judge replies. Both
 * go through this: one client shape, one price table, one error mapping.
 */

/** The slice of the Anthropic client we use, so tests can pass a fake. */
export type ClaudeClient = Pick<Anthropic['beta']['messages'], 'parse'>;

export function claudeClient(apiKey: string): ClaudeClient {
  // Explicit base URL: never inherit a stray ANTHROPIC_BASE_URL from the host environment.
  return new Anthropic({ apiKey, baseURL: 'https://api.anthropic.com' }).beta.messages;
}

/** Per-million-token list prices. Unknown models report no cost rather than a wrong one. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number) {
  const price = PRICES[model];
  return price ? (inputTokens * price.input + outputTokens * price.output) / 1e6 : null;
}

/** Map SDK errors to the runner's failure kinds: retry transient ones, stop on key or request problems. */
export function claudeFailure(role: string, error: unknown): InfraError {
  const detail = `${role}: ${error instanceof Error ? error.message : String(error)}`;
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.BadRequestError ||
    error instanceof Anthropic.NotFoundError
  ) {
    return new InfraError('account', detail);
  }
  if (error instanceof Anthropic.RateLimitError) return new InfraError('rate_limit', detail);
  return new InfraError('provider_error', detail);
}
