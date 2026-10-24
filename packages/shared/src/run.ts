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
  /** Shown and compared, but not part of pass/fail (reply quality is scored separately). */
  informational?: boolean;
}

/** Fixed label lists, so labels can be counted across runs. */
export const LEAD_INTENTS = [
  'wants_to_book',
  'gives_info',
  'asks_question',
  'accepts_offer',
  'unsure',
  'declines',
  'pushes_back',
  'asks_for_human',
  'opts_out',
  'complains',
  'thanks_or_bye',
  'other',
] as const;
export const LEAD_MOODS = ['calm', 'impatient', 'upset'] as const;
export const AGENT_ACTS = [
  'asks_question',
  'offers_options',
  'confirms_action',
  'escalates',
  'refuses',
  'informs',
  'acknowledges',
  'closes',
  'other',
] as const;
/** Problems the judge labels directly (the rubric verdicts add writes_to_operator, not_sms_style, unbacked_claim). */
export const EXTRA_ISSUES = [
  'reasked_known_info',
  'ignored_question',
  'booked_without_clear_yes',
] as const;
export const ISSUES = [
  'writes_to_operator',
  'not_sms_style',
  'unbacked_claim',
  ...EXTRA_ISSUES,
] as const;
export const OUTCOMES = [
  'booked',
  'escalated',
  'opted_out',
  'waiting_on_lead',
  'declined',
  'unresolved',
] as const;

export type LeadIntent = (typeof LEAD_INTENTS)[number];
export type LeadMood = (typeof LEAD_MOODS)[number];
export type AgentAct = (typeof AGENT_ACTS)[number];
export type Issue = (typeof ISSUES)[number];
export type Outcome = (typeof OUTCOMES)[number];

/** The judge's verdict on one agent reply. A failure carries a verbatim quote from the reply. */
export interface TurnJudgment {
  eventSeq: number;
  audience: JudgeVerdict;
  format: JudgeVerdict;
  grounded: JudgeVerdict;
  act: AgentAct;
  /** Every verified problem in this reply: the failed rubric criteria plus the judge's extra labels. */
  issues: { label: Issue; quote: string; reason: string }[];
}

export interface JudgeVerdict {
  pass: boolean;
  quote: string;
  reason: string;
  /** False when the judge failed a reply but its quote isn't in the reply: the failure is ignored. */
  verified: boolean;
}

export interface LeadLabel {
  eventSeq: number;
  intent: LeadIntent;
  mood: LeadMood;
}

export interface JudgeReport {
  model: string;
  turns: TurnJudgment[];
  leadTurns: LeadLabel[];
  questions: { checkId: string; answer: 'yes' | 'no'; quote: string; reason: string }[];
  outcome: { label: Outcome; reason: string };
  /** Did the simulated lead stick to its facts and stay in character? If not, the test itself went wrong. */
  leadConsistent: { ok: boolean; reason: string };
  /** The first agent reply with a verified problem, if any. */
  firstProblemSeq: number | null;
  /** Share of replies written to the lead in SMS style (audience and format), 0–1. */
  replyQuality: number | null;
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
