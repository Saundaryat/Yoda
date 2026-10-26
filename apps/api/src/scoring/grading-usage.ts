import { randomUUID } from 'node:crypto';

/** Returned provider usage, independent of whether a later grading stage succeeds. */
export interface GradingCallUsage {
  id: string;
  component: 'judge' | 'review' | 'classifier' | 'legacy';
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  attempt?: number;
}

export interface GradingAccounting {
  beforeCall(): Promise<void>;
  record(usage: GradingCallUsage): Promise<void>;
}

/** Generate the identity once: database retries must retain this same call id. */
export async function recordGradingUsage(
  accounting: GradingAccounting | undefined,
  component: GradingCallUsage['component'],
  model: string,
  usage: Omit<GradingCallUsage, 'id' | 'component' | 'model' | 'attempt'>,
): Promise<void> {
  await accounting?.record({ id: randomUUID(), component, model, ...usage });
}
