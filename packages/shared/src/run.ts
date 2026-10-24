import type { CheckType } from './task.js';

/** One entry in a run's timeline. `seq` is unique within the run and is what evidence points at. */
export type RunEvent =
  | {
      seq: number;
      session: number;
      turn: number;
      kind: 'lead';
      text: string;
      /** Scripted: the rule that fired. LLM: the main rule the message means, if any. */
      ruleId: string | null;
      /** LLM lead: every rule the message means (e.g. accepting a slot and "yes, book it" at once). */
      ruleIds?: string[];
      /** Scripted lead said its "nothing matched" line. */
      fallback?: boolean;
      by?: 'script' | 'llm';
    }
  | { seq: number; session: number; turn: number; kind: 'agent'; text: string }
  | {
      seq: number;
      session: number;
      turn: number;
      kind: 'tool';
      /** CRM tools without the `mcp__crm__` prefix; Hermes tools (skill_view, memory) as named. */
      tool: string;
      source: 'crm' | 'hermes';
      args: Record<string, unknown>;
      ok: boolean;
      result: unknown;
    }
  | { seq: number; session: number; turn: number; kind: 'note'; text: string };

export interface Evidence {
  eventSeq?: number;
  statePath?: string;
}

export interface CheckResult {
  checkId: string;
  type: CheckType;
  label: string;
  weight: number;
  critical: boolean;
  passed: boolean;
  detail: string;
  evidence: Evidence[];
  /** Not evaluated (e.g. no judge model configured); left out of the score. */
  skipped?: boolean;
}

/** The judge's verdict on one agent reply. A failure carries a verbatim quote from the reply. */
export interface TurnJudgment {
  eventSeq: number;
  audience: JudgeVerdict;
  format: JudgeVerdict;
  grounded: JudgeVerdict;
}

export interface JudgeVerdict {
  pass: boolean;
  quote: string;
  reason: string;
  /** False when the judge failed a reply but its quote isn't in the reply: the failure is ignored. */
  verified: boolean;
}

export interface JudgeReport {
  model: string;
  turns: TurnJudgment[];
  questions: { checkId: string; answer: 'yes' | 'no'; quote: string; reason: string }[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number | null };
}

export interface Score {
  passed: boolean;
  /** 0–100, weighted share of checks passed. */
  score: number;
  checks: CheckResult[];
}

/** A RunEvent before it is placed in the timeline (no seq/session/turn yet). */
export type RunEventBody = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, 'seq' | 'session' | 'turn'>
    : never
  : never;
