import { effectiveGroundingSeverity } from '@evals/shared';
import {
  ISSUES,
  LEAD_INTENTS,
  OUTCOMES,
  type ImprovementSummary,
  type JudgeReport,
  type TurnJudgment,
} from '@evals/shared';

export interface LabelledRun {
  runId: string;
  taskKey: string;
  side: 'a' | 'b';
  judge: JudgeReport | null;
}

/**
 * Turn per-turn judge labels into counts: which problems Hermes has and how often, how it handles
 * each kind of lead message, how conversations end. This is the "where can it improve" view.
 */
export function improvementSummary(runs: LabelledRun[]): ImprovementSummary {
  const judged = runs.filter((r): r is LabelledRun & { judge: JudgeReport } => r.judge !== null);
  const bySide = (side: 'a' | 'b') => judged.filter((r) => r.side === side);
  const replies = (side: 'a' | 'b') =>
    bySide(side).flatMap((r) => r.judge.turns.map((t) => ({ run: r, turn: t })));
  const share = (n: number, total: number) => (total ? n / total : 0);

  const issues = ISSUES.map((label) => {
    const count = (side: 'a' | 'b') =>
      replies(side).filter(({ turn }) => turn.issues.some((i) => i.label === label));
    const [hitsA, hitsB] = [count('a'), count('b')];
    return {
      label,
      a: share(hitsA.length, replies('a').length),
      b: share(hitsB.length, replies('b').length),
      countA: hitsA.length,
      countB: hitsB.length,
      exampleRunId: (hitsB[0] ?? hitsA[0])?.run.runId ?? null,
    };
  }).filter((row) => row.countA + row.countB > 0);

  /** The agent's reply right after a lead message (the next judged reply in the same run). */
  const handling = (side: 'a' | 'b', intent: string) => {
    const pairs = bySide(side).flatMap((r) =>
      r.judge.leadTurns
        .filter((l) => l.intent === intent)
        .map((l) =>
          r.judge.turns
            .filter((t) => t.eventSeq > l.eventSeq)
            .reduce<TurnJudgment | undefined>(
              (next, turn) => (!next || turn.eventSeq < next.eventSeq ? turn : next),
              undefined,
            ),
        )
        .filter((t) => t !== undefined),
    );
    return { count: pairs.length, clean: pairs.filter((t) => t.issues.length === 0).length };
  };
  const intents = LEAD_INTENTS.map((intent) => {
    const [a, b] = [handling('a', intent), handling('b', intent)];
    return {
      intent,
      countA: a.count,
      countB: b.count,
      handledA: a.count ? a.clean / a.count : null,
      handledB: b.count ? b.clean / b.count : null,
    };
  }).filter((row) => row.countA + row.countB > 0);

  const outcomes = OUTCOMES.map((label) => ({
    label,
    a: bySide('a').filter((r) => r.judge.outcome.label === label).length,
    b: bySide('b').filter((r) => r.judge.outcome.label === label).length,
  })).filter((row) => row.a + row.b > 0);

  const groundingSeverities = (['serious', 'minor'] as const)
    .map((severity) => {
      const hits = (side: 'a' | 'b') =>
        replies(side).filter(({ turn }) => effectiveGroundingSeverity(turn.grounded) === severity);
      const [a, b] = [hits('a'), hits('b')];
      return {
        severity,
        countA: a.length,
        countB: b.length,
        exampleRunId: (b[0] ?? a[0])?.run.runId ?? null,
      };
    })
    .filter((row) => row.countA + row.countB > 0);

  return {
    judgedRuns: { a: bySide('a').length, b: bySide('b').length },
    issues: issues.sort((x, y) => y.countA + y.countB - (x.countA + x.countB)),
    groundingSeverities,
    intents,
    outcomes,
    leadProblems: judged
      .filter((r) => !r.judge.leadConsistent.ok)
      .map((r) => ({
        runId: r.runId,
        taskKey: r.taskKey,
        side: r.side,
        reason: r.judge.leadConsistent.reason,
      })),
  };
}
