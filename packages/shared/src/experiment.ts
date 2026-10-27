import { z } from 'zod';
import type { Comparison } from './analysis.js';

/** Most agent versions one experiment can compare (A–F); every version adds a full set of runs. */
export const MAX_VERSIONS = 6;

/** A, B, C… for the version at `index` in an experiment's configIds. */
export const versionLetter = (index: number) => String.fromCharCode(65 + index);

export const LEAD_MODES = ['scripted', 'llm'] as const;
export type LeadMode = (typeof LEAD_MODES)[number];

export const createExperimentSchema = z
  .strictObject({
    name: z.string().min(1),
    /** Written down before running, so the result is read against a stated expectation. */
    hypothesis: z.string().default(''),
    /** Agent versions in order: the first is the baseline (A), then B, C… Replaces the pair below. */
    configIds: z.array(z.uuid()).min(2).max(MAX_VERSIONS).optional(),
    baselineConfigId: z.uuid().optional(),
    candidateConfigId: z.uuid().optional(),
    taskIds: z.array(z.uuid()).min(1),
    repetitions: z.number().int().min(1).max(10).default(3),
    /**
     * Who plays the lead. scripted: the task's regex rules (deterministic, free, best for A/B).
     * llm: Claude plays the lead from a persona (realistic, varied, costs a little per turn).
     */
    leadMode: z.enum(LEAD_MODES).default('scripted'),
  })
  .refine(
    (e) =>
      e.configIds
        ? !e.baselineConfigId && !e.candidateConfigId
        : e.baselineConfigId && e.candidateConfigId,
    { message: 'Give either configIds or baselineConfigId and candidateConfigId' },
  );

/** The ordered versions of a create request: baseline first. */
export function requestedConfigIds(input: CreateExperiment): string[] {
  return input.configIds ?? [input.baselineConfigId!, input.candidateConfigId!];
}

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
  rescoring?: {
    sourceExperimentId: string;
    evaluatorVersion: string;
    judgeOnlyCostUsd: number;
    mode?: 'judge-and-score' | 'score-only';
    sourceJudgeVersions?: string[];
    scope?: {
      kind: 'task-subset';
      taskKeys: string[];
      tasks: number;
      sourceTasks: number;
      runs: number;
      sourceRuns: number;
    };
    changes?: {
      passToFail: number;
      failToPass: number;
      unchanged: number;
      ungraded: number;
      scoreChanges: number;
    };
  };
  correctedExperimentId?: string;
  /** Paired result published alongside execution status; null before scoring. */
  result: Comparison | null;
  id: string;
  name: string;
  hypothesis: string;
  status: ExperimentStatus;
  baselineConfigId: string;
  candidateConfigId: string;
  /** Every compared version in order (baseline first). Two for a classic A/B experiment. */
  configIds: string[];
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

/** A saved run's new grade compared with the exact source run, never inferred from row order. */
export interface RunGradeChange {
  runId: string;
  sourceRunId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  /** Version letter: A, B, C… */
  side: string;
  repetition: number;
  previousPassed: boolean | null;
  passed: boolean | null;
  previousScore: number | null;
  score: number | null;
  reasons: {
    checkId: string;
    label: string;
    critical: boolean;
    previous: Pick<
      import('./run.js').CheckResult,
      'passed' | 'skipped' | 'detail' | 'evidence'
    > | null;
    current: Pick<
      import('./run.js').CheckResult,
      'passed' | 'skipped' | 'detail' | 'evidence'
    > | null;
  }[];
}
export interface GradeChangeReport {
  sourceExperimentId: string;
  evaluatorVersion: string;
  mode: 'judge-and-score' | 'score-only' | 'historical';
  comparedRuns: number;
  unmatchedRuns: number;
  passToFail: number;
  failToPass: number;
  scoreOnlyChanges: number;
  unchanged: number;
  changes: RunGradeChange[];
}
