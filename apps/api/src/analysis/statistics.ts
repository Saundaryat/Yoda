/**
 * The comparison statistics, as plain functions so they can be tested and reasoned about.
 *
 * Unit of analysis: the task. Each task is run k times under A and under B; a task's pass rate is
 * its passes / runs. The headline is the average over tasks of (B rate − A rate), so every task
 * counts equally however many runs it has. Uncertainty comes from a two-level bootstrap: resample
 * tasks (which tasks we happened to write), then resample runs within each task (run-to-run noise).
 */

import type { Comparison, Verdict } from '@evals/shared';

/** Per-task samples under each configuration (one value per scored run). */
export interface Paired<T> {
  taskId: string;
  a: T[];
  b: T[];
}

export type TaskRuns = Paired<boolean>;

/** Deterministic PRNG (mulberry32) so a report recomputes to the same interval. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const rate = (runs: boolean[]) => mean(runs.map(Number));

function standardDeviation(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function quantile(sorted: number[], q: number): number {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function resample<T>(xs: T[], random: () => number): T[] {
  return xs.map(() => xs[Math.floor(random() * xs.length)]!);
}

/** 95% percentile interval for the mean of `statistic` over tasks, two-level bootstrap. */
export function bootstrapInterval<T>(
  tasks: Paired<T>[],
  statistic: (task: Paired<T>) => number,
  { samples = 10_000, seed = 1 } = {},
): [number, number] {
  if (!tasks.length) return [0, 0];
  const random = seededRandom(seed);
  const estimates = Array.from({ length: samples }, () =>
    mean(
      resample(tasks, random).map((task) =>
        statistic({
          taskId: task.taskId,
          a: resample(task.a, random),
          b: resample(task.b, random),
        }),
      ),
    ),
  ).sort((x, y) => x - y);
  return [quantile(estimates, 0.025), quantile(estimates, 0.975)];
}

function logChoose(n: number, k: number): number {
  let total = 0;
  for (let i = 1; i <= k; i++) total += Math.log(n - k + i) - Math.log(i);
  return total;
}

/** Two-sided exact binomial test that wins and losses are equally likely. */
export function signTest(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  let tail = 0;
  for (let i = 0; i <= k; i++) tail += Math.exp(logChoose(n, i) - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

const difference = (task: TaskRuns) => rate(task.b) - rate(task.a);

/** Mean of B minus mean of A per task, averaged over tasks with data on both sides, with an interval. */
export function compareMetric(tasks: Paired<number>[], { samples = 10_000, seed = 1 } = {}) {
  const both = tasks.filter((t) => t.a.length && t.b.length);
  if (!both.length) return { a: null, b: null, difference: null, ci: null };
  const delta = (t: Paired<number>) => mean(t.b) - mean(t.a);
  return {
    a: mean(both.map((t) => mean(t.a))),
    b: mean(both.map((t) => mean(t.b))),
    difference: mean(both.map(delta)),
    ci: bootstrapInterval(both, delta, { samples, seed }),
  };
}

/**
 * Compare B against A. `practicalMargin` is the smallest difference worth acting on: an interval
 * entirely inside ±margin means "no meaningful difference", not merely "not significant".
 */
export function compare(
  tasks: TaskRuns[],
  { plannedTasks = tasks.length, practicalMargin = 0.1, samples = 10_000, seed = 1 } = {},
): Comparison {
  const paired = tasks.filter((t) => t.a.length > 0 && t.b.length > 0);
  const diffs = paired.map(difference);
  const ci = bootstrapInterval(paired, difference, { samples, seed });
  const wins = diffs.filter((d) => d > 0).length;
  const losses = diffs.filter((d) => d < 0).length;
  const spread = standardDeviation(diffs);
  const comparison: Omit<Comparison, 'verdict'> = {
    difference: mean(diffs),
    ci,
    passRateA: mean(paired.map((t) => rate(t.a))),
    passRateB: mean(paired.map((t) => rate(t.b))),
    pairedTasks: paired.length,
    plannedTasks,
    wins,
    losses,
    signTestP: signTest(wins, losses),
    // 2.8 ≈ z(0.975) + z(0.80): the usual normal-approximation power rule.
    minimumDetectable:
      paired.length >= 2 && spread > 0 ? (2.8 * spread) / Math.sqrt(paired.length) : null,
    practicalMargin,
  };
  return { ...comparison, verdict: verdictFor(comparison) };
}

/**
 * Below this many paired tasks the interval is too unstable to act on (with a handful of tasks
 * all tied, the bootstrap interval collapses to [0, 0]); the verdict stays inconclusive.
 */
export const MIN_TASKS_FOR_VERDICT = 10;

export function verdictFor(c: Omit<Comparison, 'verdict'>): Verdict {
  if (c.pairedTasks === 0 || c.pairedTasks < 0.9 * c.plannedTasks) return 'incomplete';
  if (c.pairedTasks < MIN_TASKS_FOR_VERDICT) return 'inconclusive';
  const [low, high] = c.ci;
  if (low > 0) return 'better';
  if (high < 0) return 'worse';
  if (low >= -c.practicalMargin && high <= c.practicalMargin) return 'no_meaningful_difference';
  return 'inconclusive';
}

/** Share of tasks where every run passed (pass^k): rewards consistency, not lucky passes. */
export function allRunsPassRate(tasks: TaskRuns[], side: 'a' | 'b'): number {
  const withRuns = tasks.filter((t) => t[side].length > 0);
  return mean(withRuns.map((t) => Number(t[side].every(Boolean))));
}
