import { describe, expect, it } from 'vitest';
import { leaderboard, type VersionRun } from './leaderboard.js';
import { compare } from './statistics.js';

const taskIds = Array.from({ length: 12 }, (_, i) => `t${i}`);
const run = (configId: string, taskId: string, passed: boolean, costUsd = 0.01): VersionRun => ({
  taskId,
  configId,
  passed,
  score: passed ? 100 : 40,
  costUsd,
  durationMs: 1000,
  totalTokens: 500,
});
/** `passing` tasks pass on every repetition; the rest fail. */
const version = (configId: string, passing: number, repetitions = 2, costUsd?: number) =>
  taskIds.flatMap((taskId, i) =>
    Array.from({ length: repetitions }, () => run(configId, taskId, i < passing, costUsd)),
  );

describe('leaderboard', () => {
  it('ranks every version by task-weighted pass rate, A first on ties', () => {
    const board = leaderboard([...version('a', 6), ...version('b', 12), ...version('c', 6)], {
      configIds: ['a', 'b', 'c'],
      taskIds,
      repetitions: 2,
      samples: 500,
    });
    expect(board.entries.map((e) => [e.letter, e.rank, e.passRate])).toEqual([
      ['B', 1, 1],
      ['A', 2, 0.5],
      ['C', 2, 0.5],
    ]);
    const b = board.entries[0]!;
    expect(b.allRunsPass).toBe(1);
    expect(b.meanScore).toBe(100);
    expect(b.scoredRuns).toBe(24);
    expect(b.plannedRuns).toBe(24);
    expect(board.entries.find((e) => e.letter === 'A')!.vsBaseline).toBeNull();
  });

  it('compares each candidate with the baseline at a Bonferroni-adjusted level', () => {
    const runs = [...version('a', 6), ...version('b', 12), ...version('c', 7), ...version('d', 5)];
    const board = leaderboard(runs, {
      configIds: ['a', 'b', 'c', 'd'],
      taskIds,
      repetitions: 2,
      samples: 500,
    });
    expect(board.comparisonConfidence).toBeCloseTo(1 - 0.05 / 3);
    const b = board.entries.find((e) => e.letter === 'B')!.vsBaseline!;
    expect(b.confidenceLevel).toBeCloseTo(1 - 0.05 / 3);
    expect(b.difference).toBeCloseTo(0.5);
    // The adjusted interval is at least as wide as the unadjusted 95% interval.
    const plain = compare(
      taskIds.map((taskId, i) => ({ taskId, a: [i < 6, i < 6], b: [true, true] })),
      { samples: 500 },
    );
    expect(b.ci[0]).toBeLessThanOrEqual(plain.ci[0] + 1e-9);
    expect(b.ci[1]).toBeGreaterThanOrEqual(plain.ci[1] - 1e-9);
  });

  it('matches the classic A/B comparison exactly when there are two versions', () => {
    const runs = [...version('a', 4), ...version('b', 9)];
    const board = leaderboard(runs, {
      configIds: ['a', 'b'],
      taskIds,
      repetitions: 2,
      samples: 500,
    });
    const classic = compare(
      taskIds.map((taskId, i) => ({ taskId, a: [i < 4, i < 4], b: [i < 9, i < 9] })),
      { samples: 500 },
    );
    expect(board.comparisonConfidence).toBe(0.95);
    expect(board.entries.find((e) => e.letter === 'B')!.vsBaseline).toEqual(classic);
  });

  it('reports task-weighted cost and handles versions with no scored runs yet', () => {
    const board = leaderboard([...version('a', 3, 2, 0.02)], {
      configIds: ['a', 'b'],
      taskIds,
      repetitions: 2,
      samples: 200,
    });
    const a = board.entries.find((e) => e.letter === 'A')!;
    const b = board.entries.find((e) => e.letter === 'B')!;
    expect(a.costUsd).toBeCloseTo(0.02);
    expect(b).toMatchObject({ scoredRuns: 0, passRate: 0, costUsd: null, meanScore: null });
    expect(b.vsBaseline!.verdict).toBe('incomplete');
  });
});
