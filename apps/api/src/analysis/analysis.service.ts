import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CheckFlip,
  ExperimentResults,
  JudgeReport,
  RunEvent,
  TaskDefinition,
  TaskResult,
} from '@evals/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { checkResults, experiments, runEvents, runs, tasks } from '../db/schema.js';
import {
  allRunsPassRate,
  compare,
  compareMetric,
  mean,
  type Paired,
  type TaskRuns,
} from './statistics.js';

type Side = 'a' | 'b';

/** Turns an experiment's scored runs into the comparison the results page shows. */
@Injectable()
export class AnalysisService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async results(experimentId: string): Promise<ExperimentResults> {
    const [experiment] = await this.db
      .select()
      .from(experiments)
      .where(eq(experiments.id, experimentId));
    if (!experiment) throw new NotFoundException(`Experiment ${experimentId} not found`);

    const taskRows = experiment.taskIds.length
      ? await this.db.select().from(tasks).where(inArray(tasks.id, experiment.taskIds))
      : [];
    const allRuns = await this.db.select().from(runs).where(eq(runs.experimentId, experimentId));
    const scored = allRuns.filter((r) => r.status === 'scored');
    const sideOf = (configId: string): Side =>
      configId === experiment.baselineConfigId ? 'a' : 'b';

    const checks = scored.length
      ? await this.db
          .select()
          .from(checkResults)
          .where(
            inArray(
              checkResults.runId,
              scored.map((r) => r.id),
            ),
          )
      : [];
    const hermesTools = scored.length
      ? await this.db
          .select({ runId: runEvents.runId, payload: runEvents.payload })
          .from(runEvents)
          .where(
            and(
              inArray(
                runEvents.runId,
                scored.map((r) => r.id),
              ),
              eq(runEvents.kind, 'tool'),
            ),
          )
      : [];

    // Per task, in the experiment's task order.
    const taskResults: TaskResult[] = experiment.taskIds.map((taskId) => {
      const row = taskRows.find((t) => t.id === taskId)!;
      const definition = row.definition as TaskDefinition;
      const forSide = (side: Side) =>
        scored
          .filter((r) => r.taskId === taskId && sideOf(r.configId) === side)
          .sort((x, y) => x.repetition - y.repetition)
          .map((r) => ({ runId: r.id, passed: r.passed!, score: r.score! }));
      return {
        taskId,
        key: row.key,
        title: row.title,
        family: row.family,
        group: definition.group,
        a: forSide('a'),
        b: forSide('b'),
      };
    });
    const rejectedByRun = new Map<string, number>();
    for (const { runId, payload } of hermesTools) {
      const event = payload as Extract<RunEvent, { kind: 'tool' }>;
      if (event.source === 'crm' && !event.ok)
        rejectedByRun.set(runId, (rejectedByRun.get(runId) ?? 0) + 1);
    }

    const passes: TaskRuns[] = taskResults.map((t) => ({
      taskId: t.taskId,
      a: t.a.map((r) => r.passed),
      b: t.b.map((r) => r.passed),
    }));

    const groups = [...new Set(taskResults.map((t) => t.group))].map((group) => {
      const inGroup = passes.filter((_, i) => taskResults[i]!.group === group);
      const c = compare(inGroup, { samples: 5_000 });
      return {
        group,
        tasks: inGroup.length,
        difference: c.difference,
        ci: c.ci,
        passRateA: c.passRateA,
        passRateB: c.passRateB,
      };
    });

    const metric = (value: (run: (typeof scored)[number]) => number | null): Paired<number>[] =>
      taskResults.map((t) => {
        const valuesFor = (side: Side) =>
          scored
            .filter((r) => r.taskId === t.taskId && sideOf(r.configId) === side)
            .map(value)
            .filter((v): v is number => v !== null);
        return { taskId: t.taskId, a: valuesFor('a'), b: valuesFor('b') };
      });

    return {
      comparison: compare(passes, { plannedTasks: experiment.taskIds.length }),
      coverage: {
        plannedRuns: allRuns.length || experiment.taskIds.length * experiment.repetitions * 2,
        scoredRuns: scored.length,
        errorRuns: allRuns.filter((r) => r.status === 'error').length,
        cancelledRuns: allRuns.filter((r) => r.status === 'cancelled').length,
        openRuns: allRuns.filter((r) => r.status === 'queued' || r.status === 'running').length,
      },
      allRunsPass: { a: allRunsPassRate(passes, 'a'), b: allRunsPassRate(passes, 'b') },
      groups,
      tasks: taskResults,
      ...this.checkMovements(scored, checks, taskResults, sideOf),
      metrics: {
        costUsd: compareMetric(metric((r) => r.costUsd)),
        durationMs: compareMetric(metric((r) => r.durationMs)),
        totalTokens: compareMetric(metric((r) => (r.inputTokens ?? 0) + (r.outputTokens ?? 0))),
        leadFallbacks: compareMetric(metric((r) => r.leadFallbacks)),
        replyQuality: compareMetric(metric((r) => replyQuality(r.judge as JudgeReport | null))),
        rejectedToolCalls: compareMetric(metric((r) => rejectedByRun.get(r.id) ?? 0)),
      },
      hermesToolUse: this.hermesToolUse(scored, hermesTools, sideOf),
    };
  }

  private checkMovements(
    scored: (typeof runs.$inferSelect)[],
    checks: (typeof checkResults.$inferSelect)[],
    taskResults: TaskResult[],
    sideOf: (configId: string) => Side,
  ): Pick<ExperimentResults, 'checkFlips' | 'criticalRegressions'> {
    const runById = new Map(scored.map((r) => [r.id, r]));
    const tally = new Map<
      string,
      CheckFlip & { n: Record<Side, number>; pass: Record<Side, number> }
    >();
    for (const check of checks) {
      const run = runById.get(check.runId)!;
      const task = taskResults.find((t) => t.taskId === run.taskId)!;
      const key = `${run.taskId}/${check.checkId}`;
      const entry = tally.get(key) ?? {
        taskId: run.taskId,
        taskKey: task.key,
        checkId: check.checkId,
        label: check.label,
        critical: check.critical,
        passRateA: 0,
        passRateB: 0,
        n: { a: 0, b: 0 },
        pass: { a: 0, b: 0 },
      };
      const side = sideOf(run.configId);
      entry.n[side] += 1;
      entry.pass[side] += Number(check.passed);
      tally.set(key, entry);
    }
    const flips = [...tally.values()]
      .filter((e) => e.n.a && e.n.b)
      .map(({ n, pass, ...flip }) => ({
        ...flip,
        passRateA: pass.a / n.a,
        passRateB: pass.b / n.b,
      }));
    return {
      checkFlips: flips
        .filter((f) => f.passRateA !== f.passRateB)
        .sort((x, y) => Math.abs(y.passRateB - y.passRateA) - Math.abs(x.passRateB - x.passRateA)),
      criticalRegressions: flips.filter((f) => f.critical && f.passRateA === 1 && f.passRateB < 1),
    };
  }

  private hermesToolUse(
    scored: (typeof runs.$inferSelect)[],
    toolEvents: { runId: string; payload: unknown }[],
    sideOf: (configId: string) => Side,
  ): ExperimentResults['hermesToolUse'] {
    const used = new Map<string, Set<string>>();
    for (const { runId, payload } of toolEvents) {
      const event = payload as Extract<RunEvent, { kind: 'tool' }>;
      if (event.source !== 'hermes') continue;
      if (!used.has(event.tool)) used.set(event.tool, new Set());
      used.get(event.tool)!.add(runId);
    }
    const share = (tool: string, side: Side) => {
      const sideRuns = scored.filter((r) => sideOf(r.configId) === side);
      return sideRuns.length ? mean(sideRuns.map((r) => Number(used.get(tool)!.has(r.id)))) : 0;
    };
    return [...used.keys()]
      .sort()
      .map((tool) => ({ tool, a: share(tool, 'a'), b: share(tool, 'b') }));
  }
}

/** Share of a run's replies with no verified judge failure; null when the run wasn't judged. */
function replyQuality(judge: JudgeReport | null): number | null {
  if (!judge?.turns.length) return null;
  const clean = judge.turns.filter((t) =>
    [t.audience, t.format, t.grounded].every((v) => v.pass || !v.verified),
  );
  return clean.length / judge.turns.length;
}
