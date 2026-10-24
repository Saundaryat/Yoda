export type Verdict =
  'better' | 'worse' | 'no_meaningful_difference' | 'inconclusive' | 'incomplete';

/** Minimum paired scenarios required before an experiment can produce a decisive verdict. */
export const MIN_TASKS_FOR_VERDICT = 10;

export interface Comparison {
  verdict: Verdict;
  /** Mean over paired tasks of (B pass rate − A pass rate), in [-1, 1]. */
  difference: number;
  /** 95% interval for `difference` (two-level bootstrap: tasks, then runs within a task). */
  ci: [number, number];
  passRateA: number;
  passRateB: number;
  pairedTasks: number;
  plannedTasks: number;
  /** Tasks where B's pass rate beat A's, and the reverse. Ties are not counted. */
  wins: number;
  losses: number;
  /** Two-sided exact sign test on wins vs losses. */
  signTestP: number;
  /** Roughly the smallest true difference this design detects 80% of the time. */
  minimumDetectable: number | null;
  practicalMargin: number;
}

export interface MetricComparison {
  a: number | null;
  b: number | null;
  /** B − A, averaged over tasks, with a 95% interval. Null when either side has no data. */
  difference: number | null;
  ci: [number, number] | null;
}

export interface TaskResult {
  taskId: string;
  key: string;
  title: string;
  family: string;
  group: string;
  a: { runId: string; passed: boolean; score: number }[];
  b: { runId: string; passed: boolean; score: number }[];
}

export interface CheckFlip {
  taskId: string;
  taskKey: string;
  checkId: string;
  label: string;
  critical: boolean;
  passRateA: number;
  passRateB: number;
}

export interface ExperimentResults {
  comparison: Comparison;
  coverage: {
    plannedRuns: number;
    scoredRuns: number;
    errorRuns: number;
    cancelledRuns: number;
    openRuns: number;
  };
  /** Share of tasks where every run passed (pass^k). */
  allRunsPass: { a: number; b: number };
  groups: (Pick<Comparison, 'difference' | 'ci' | 'passRateA' | 'passRateB'> & {
    group: string;
    tasks: number;
  })[];
  tasks: TaskResult[];
  /** Checks whose pass rate moved between A and B, biggest moves first. */
  checkFlips: CheckFlip[];
  /** Critical checks B failed at least once that A never failed. */
  criticalRegressions: CheckFlip[];
  metrics: {
    costUsd: MetricComparison;
    durationMs: MetricComparison;
    totalTokens: MetricComparison;
    leadFallbacks: MetricComparison;
    /** Share of replies the judge passed on audience, format and grounding (judged runs only). */
    replyQuality: MetricComparison;
    /** CRM calls the CRM rejected (wrong ids, unavailable slots...): a sign of sloppy tool use. */
    rejectedToolCalls: MetricComparison;
  };
  /** Share of runs that called each Hermes tool (skill_view, memory, ...): the mechanism, not just the outcome. */
  hermesToolUse: { tool: string; a: number; b: number }[];
}
