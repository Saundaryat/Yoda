import { versionLetter, type Leaderboard, type LeaderboardEntry } from '@evals/shared';
import { allRunsPassRate, bootstrapInterval, compare, mean, type TaskRuns } from './statistics.js';

export interface VersionRun {
  taskId: string;
  configId: string;
  passed: boolean;
  score: number;
  costUsd: number | null;
  durationMs: number | null;
  totalTokens: number | null;
}

type CompareOptions = NonNullable<Parameters<typeof compare>[1]>;

/** Familywise error rate shared by all comparisons against the baseline. */
const FAMILY_ALPHA = 0.05;

/**
 * Rank every version of a multi-version experiment. Each version's pass rate is task-weighted like
 * the paired comparison, with its own two-level bootstrap interval. Each non-baseline version is
 * also compared against the baseline with the paired method; with k such comparisons each interval
 * uses level 1 − 0.05/k (Bonferroni), so the chance of any spurious "better" stays near 5%.
 */
export function leaderboard(
  runs: VersionRun[],
  {
    configIds,
    taskIds,
    repetitions,
    samples = 10_000,
    pairOptions = () => ({}),
  }: {
    configIds: string[];
    taskIds: string[];
    repetitions: number;
    samples?: number;
    /** Completeness options for the paired comparison of [baseline, version]. */
    pairOptions?: (pair: [string, string]) => CompareOptions;
  },
): Leaderboard {
  const comparisonConfidence = 1 - FAMILY_ALPHA / Math.max(1, configIds.length - 1);
  const passesFor = (configId: string, taskId: string) =>
    runs.filter((r) => r.configId === configId && r.taskId === taskId).map((r) => r.passed);
  const taskMean = (configId: string, value: (run: VersionRun) => number | null) => {
    const perTask = taskIds
      .map((taskId) =>
        runs
          .filter((r) => r.configId === configId && r.taskId === taskId)
          .map(value)
          .filter((v): v is number => v !== null),
      )
      .filter((values) => values.length);
    return perTask.length ? mean(perTask.map(mean)) : null;
  };
  const [baseline] = configIds;

  const entries = configIds.map((configId, index): Omit<LeaderboardEntry, 'rank'> => {
    const tasks: TaskRuns[] = taskIds
      .map((taskId) => ({ taskId, a: passesFor(configId, taskId), b: [] }))
      .filter((t) => t.a.length);
    const rateOf = (t: TaskRuns) => mean(t.a.map(Number));
    return {
      configId,
      letter: versionLetter(index),
      passRate: mean(tasks.map(rateOf)),
      ci: bootstrapInterval(tasks, rateOf, { samples }),
      allRunsPass: allRunsPassRate(tasks, 'a'),
      meanScore: taskMean(configId, (r) => r.score),
      scoredRuns: runs.filter((r) => r.configId === configId).length,
      plannedRuns: taskIds.length * repetitions,
      costUsd: taskMean(configId, (r) => r.costUsd),
      durationMs: taskMean(configId, (r) => r.durationMs),
      totalTokens: taskMean(configId, (r) => r.totalTokens),
      vsBaseline:
        index === 0 || !baseline
          ? null
          : compare(
              taskIds.map((taskId) => ({
                taskId,
                a: passesFor(baseline, taskId),
                b: passesFor(configId, taskId),
              })),
              {
                samples,
                ...pairOptions([baseline, configId]),
                confidence: comparisonConfidence,
              },
            ),
    };
  });
  const ranked = entries.map((entry) => ({
    ...entry,
    rank: 1 + entries.filter((other) => other.passRate > entry.passRate + 1e-9).length,
  }));
  ranked.sort((x, y) => x.rank - y.rank || x.letter.localeCompare(y.letter));
  return { entries: ranked, comparisonConfidence };
}
