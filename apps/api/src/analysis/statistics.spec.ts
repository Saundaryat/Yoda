import {
  allRunsPassRate,
  hasCompleteRunCoverage,
  bootstrapInterval,
  compare,
  seededRandom,
  signTest,
  verdictFor,
  type TaskRuns,
} from './statistics.js';

const task = (taskId: string, a: number[], b: number[]): TaskRuns => ({
  taskId,
  a: a.map(Boolean),
  b: b.map(Boolean),
});

describe('signTest', () => {
  it('matches exact binomial values', () => {
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(5, 0)).toBeCloseTo(0.0625, 6); // 2 × 0.5^5
    expect(signTest(7, 1)).toBeCloseTo(0.0703125, 6); // 2 × 9/256
    expect(signTest(4, 4)).toBe(1);
  });
});

describe('compare', () => {
  it('computes the macro difference and counts wins and losses', () => {
    const result = compare([
      task('t1', [0, 0, 0], [1, 1, 1]),
      task('t2', [1, 1, 1], [1, 1, 1]),
      task('t3', [1, 1, 0], [1, 0, 0]),
    ]);
    expect(result.difference).toBeCloseTo((1 + 0 - 1 / 3) / 3);
    expect(result).toMatchObject({ wins: 1, losses: 1, pairedTasks: 3 });
    expect(result.passRateA).toBeCloseTo(5 / 9);
    expect(result.passRateB).toBeCloseTo(7 / 9);
  });

  it('is reproducible for a given seed', () => {
    const tasks = [task('t1', [0, 1, 0], [1, 1, 0]), task('t2', [1, 0, 1], [1, 1, 1])];
    expect(compare(tasks, { seed: 7 }).ci).toEqual(compare(tasks, { seed: 7 }).ci);
  });

  it('calls a large consistent improvement "better"', () => {
    const tasks = Array.from({ length: 20 }, (_, i) =>
      i < 10 ? task(`t${i}`, [0, 0, 0], [1, 1, 1]) : task(`t${i}`, [1, 1, 1], [1, 1, 1]),
    );
    const result = compare(tasks, { samples: 2_000 });
    expect(result.verdict).toBe('better');
    expect(result.ci[0]).toBeGreaterThan(0.2);
    expect(result.signTestP).toBeLessThan(0.01);
  });

  it('calls identical results "no meaningful difference" only when the interval is tight', () => {
    const same = Array.from({ length: 20 }, (_, i) => task(`t${i}`, [1, 1, 1], [1, 1, 1]));
    expect(compare(same).verdict).toBe('no_meaningful_difference');
    const noisy = Array.from({ length: 4 }, (_, i) => task(`t${i}`, [1, 0, 1], [0, 1, 1]));
    expect(compare(noisy).verdict).toBe('inconclusive');
  });

  it('reports incomplete coverage instead of a verdict', () => {
    const tasks = [task('t1', [1], [1]), task('t2', [], [1]), task('t3', [0], [])];
    const result = compare(tasks, { plannedTasks: 3 });
    expect(result).toMatchObject({ verdict: 'incomplete', pairedTasks: 1 });
  });
});

describe('verdictFor', () => {
  const base = {
    difference: 0,
    passRateA: 0.5,
    passRateB: 0.5,
    pairedTasks: 20,
    plannedTasks: 20,
    wins: 0,
    losses: 0,
    signTestP: 1,
    minimumDetectable: 0.2,
    practicalMargin: 0.1,
  };
  it.each([
    [[0.11, 0.3], 'better'],
    [[-0.3, -0.11], 'worse'],
    [[-0.08, 0.09], 'no_meaningful_difference'],
    [[-0.05, 0.25], 'inconclusive'],
  ] as const)('maps interval %j to %s', (ci, verdict) => {
    expect(verdictFor({ ...base, ci: [...ci] })).toBe(verdict);
  });
});

describe('small experiments', () => {
  it('never give a decisive verdict on fewer than 10 paired tasks', () => {
    const allTied = Array.from({ length: 7 }, (_, i) => task(`t${i}`, [1], [1]));
    expect(compare(allTied)).toMatchObject({ verdict: 'inconclusive', ci: [0, 0] });
    const allWon = Array.from({ length: 7 }, (_, i) => task(`t${i}`, [0], [1]));
    expect(compare(allWon).verdict).toBe('inconclusive');
  });
});

describe('allRunsPassRate', () => {
  it('only counts tasks where every run passed', () => {
    const tasks = [task('t1', [1, 1, 1], [1]), task('t2', [1, 0, 1], [1]), task('t3', [], [0])];
    expect(allRunsPassRate(tasks, 'a')).toBe(0.5);
    expect(allRunsPassRate(tasks, 'b')).toBeCloseTo(2 / 3);
  });
});

describe('calibration: A against itself', () => {
  // Two identical configurations: any "better"/"worse" is a false alarm. Each simulated experiment
  // has 20 tasks of different difficulty, 3 runs per side drawn from the same pass probability.
  it('rarely claims a difference that is not there, and the interval covers zero', () => {
    const random = seededRandom(2026);
    const experiments = 400;
    let falseAlarms = 0;
    let covered = 0;
    for (let e = 0; e < experiments; e++) {
      const tasks = Array.from({ length: 20 }, (_, i) => {
        const p = 0.2 + 0.75 * random();
        const draw = () => Array.from({ length: 3 }, () => random() < p);
        return { taskId: `t${i}`, a: draw(), b: draw() };
      });
      const result = compare(tasks, { samples: 1_000, seed: e });
      if (result.verdict === 'better' || result.verdict === 'worse') falseAlarms += 1;
      if (result.ci[0] <= 0 && result.ci[1] >= 0) covered += 1;
    }
    expect(falseAlarms / experiments).toBeLessThan(0.08);
    expect(covered / experiments).toBeGreaterThan(0.92);
  });

  // Power of the default design (20 tasks × 3 runs): what the docs' "smallest detectable change"
  // claim rests on. A 30-point average gain is usually caught; a 20-point one only about a third
  // of the time.
  function power(liftOnHalf: number, baseline: number): number {
    const random = seededRandom(7);
    let detected = 0;
    for (let e = 0; e < 200; e++) {
      const tasks = Array.from({ length: 20 }, (_, i) => {
        const lift = i < 10 ? liftOnHalf : 0;
        const draw = (q: number) => Array.from({ length: 3 }, () => random() < q);
        return { taskId: `t${i}`, a: draw(baseline), b: draw(baseline + lift) };
      });
      if (compare(tasks, { samples: 1_000, seed: e }).verdict === 'better') detected += 1;
    }
    return detected / 200;
  }

  it('usually detects a 40-point gain beyond the practical margin', () => {
    expect(power(0.8, 0.1)).toBeGreaterThan(0.7);
  });

  it('often misses a 20-point average improvement (a stated limit, not a bug)', () => {
    expect(power(0.4, 0.5)).toBeLessThan(0.6);
  });
});

describe('bootstrapInterval', () => {
  it('is degenerate with no tasks', () => {
    expect(bootstrapInterval([], () => 1)).toEqual([0, 0]);
  });
});

describe('complete coverage and practical verdict regressions', () => {
  const won = Array.from({ length: 20 }, (_, i) => task(`t${i}`, [0], [1]));
  it('keeps missing repetitions incomplete even when all twenty tasks have both arms', () => {
    expect(compare(won, { plannedRepetitions: 3, experimentStatus: 'finished' })).toMatchObject({
      verdict: 'incomplete',
      complete: false,
    });
  });
  it('requires all planned tasks, not ninety percent', () => {
    expect(compare(won.slice(0, 18), { plannedTasks: 20 })).toMatchObject({
      verdict: 'incomplete',
      complete: false,
    });
  });
  it.each(['running', 'cancelled'])(
    'never declares a winner for a %s experiment',
    (experimentStatus) => {
      expect(compare(won, { plannedRepetitions: 1, experimentStatus }).verdict).toBe('incomplete');
    },
  );
  it('applies the same version and verdict once all planned work is finished', () => {
    expect(compare(won, { plannedRepetitions: 1, experimentStatus: 'finished' })).toMatchObject({
      verdict: 'better',
      complete: true,
      comparisonVersion: 'paired-task-bootstrap-v2',
    });
  });
  it.each([
    [[0.01, 0.03], 'no_meaningful_difference'],
    [[0.05, 0.3], 'inconclusive'],
    [[-0.3, -0.05], 'inconclusive'],
    [[0.1, 0.3], 'inconclusive'],
    [[-0.3, -0.1], 'inconclusive'],
  ] as const)('respects the practical margin for %j', (ci, verdict) => {
    expect(verdictFor({ ...compare(won), ci: [...ci], practicalMargin: 0.1 })).toBe(verdict);
  });
  it('rejects duplicate identities, missing grades and missing rows in coverage', () => {
    const records = ['a', 'b'].map((configId) => ({
      taskId: 't',
      configId,
      repetition: 1,
      status: 'scored',
      passed: true,
      score: 100,
    }));
    expect(hasCompleteRunCoverage(records, ['t'], ['a', 'b'], 1)).toBe(true);
    expect(hasCompleteRunCoverage([records[0]!, records[0]!], ['t'], ['a', 'b'], 1)).toBe(false);
    expect(
      hasCompleteRunCoverage(
        [{ ...records[0]!, passed: null, score: null }, records[1]!],
        ['t'],
        ['a', 'b'],
        1,
      ),
    ).toBe(false);
    expect(hasCompleteRunCoverage(records.slice(0, 1), ['t'], ['a', 'b'], 1)).toBe(false);
  });
});
