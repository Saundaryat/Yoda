import { z } from 'zod';

export const LEAD_MODES = ['scripted', 'llm'] as const;
export type LeadMode = (typeof LEAD_MODES)[number];

export const createExperimentSchema = z.strictObject({
  name: z.string().min(1),
  /** Written down before running, so the result is read against a stated expectation. */
  hypothesis: z.string().default(''),
  baselineConfigId: z.uuid(),
  candidateConfigId: z.uuid(),
  taskIds: z.array(z.uuid()).min(1),
  repetitions: z.number().int().min(1).max(10).default(3),
  /**
   * Who plays the lead. scripted: the task's regex rules (deterministic, free, best for A/B).
   * llm: Claude plays the lead from a persona (realistic, varied, costs a little per turn).
   */
  leadMode: z.enum(LEAD_MODES).default('scripted'),
});

export type CreateExperiment = z.infer<typeof createExperimentSchema>;

export type ExperimentStatus = 'draft' | 'running' | 'finished' | 'cancelled';
export type RunStatus = 'queued' | 'running' | 'scored' | 'error' | 'cancelled';

export type RunErrorKind =
  'rate_limit' | 'timeout' | 'provider_error' | 'crash' | 'account' | 'cost_cap';

export interface RunSummary {
  id: string;
  taskId: string;
  configId: string;
  repetition: number;
  status: RunStatus;
  attempts: number;
  passed: boolean | null;
  score: number | null;
  errorKind: RunErrorKind | null;
  errorDetail: string | null;
  costUsd: number | null;
  durationMs: number | null;
}

export interface ExperimentSummary {
  id: string;
  name: string;
  hypothesis: string;
  status: ExperimentStatus;
  baselineConfigId: string;
  candidateConfigId: string;
  taskIds: string[];
  repetitions: number;
  leadMode: LeadMode;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  counts: Record<RunStatus, number>;
  /** Agent (Hermes) spend plus LLM-lead spend. */
  costUsd: number;
}

/** Pushed over SSE whenever a run changes state. */
export interface ProgressEvent {
  experimentId: string;
  runId: string | null;
  status: RunStatus | ExperimentStatus;
}
