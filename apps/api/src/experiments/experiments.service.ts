import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateExperiment,
  ExperimentSummary,
  GradeChangeReport,
  RunGradeChange,
  RunStatus,
  RunSummary,
} from '@evals/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { checkResults, configurations, experiments, runEvents, runs, tasks } from '../db/schema.js';
import { RunQueueService } from '../runner/run-queue.service.js';
import { compare, hasCompleteRunCoverage } from '../analysis/statistics.js';

import { costBreakdown } from './cost-breakdown.js';

type ExperimentRow = typeof experiments.$inferSelect;

const EMPTY_COUNTS: Record<RunStatus, number> = {
  queued: 0,
  running: 0,
  scored: 0,
  error: 0,
  cancelled: 0,
};

@Injectable()
export class ExperimentsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly queue: RunQueueService,
  ) {}

  async create(input: CreateExperiment): Promise<ExperimentSummary> {
    if (input.baselineConfigId === input.candidateConfigId) {
      throw new BadRequestException('Pick two different configurations');
    }
    const configs = await this.db
      .select()
      .from(configurations)
      .where(inArray(configurations.id, [input.baselineConfigId, input.candidateConfigId]));
    if (configs.length !== 2) throw new BadRequestException('Unknown configuration');
    const taskIds = [...new Set(input.taskIds)];
    const found = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(inArray(tasks.id, taskIds));
    if (found.length !== taskIds.length) throw new BadRequestException('Unknown task');

    const [row] = await this.db
      .insert(experiments)
      .values({ ...input, taskIds, executionSnapshot: this.queue.snapshot(configs) })
      .returning();
    return this.summary(row!);
  }

  /**
   * Queue every (task, configuration, repetition) scenario. A and B of the same task and
   * repetition are queued next to each other, alternating which goes first, so a provider slowing
   * down or changing mid-experiment hits both sides alike.
   */
  async start(id: string): Promise<ExperimentSummary> {
    await this.db.transaction(async (tx) => {
      const [experiment] = await tx
        .select()
        .from(experiments)
        .where(eq(experiments.id, id))
        .for('update');
      if (!experiment) throw new NotFoundException(`Experiment ${id} not found`);
      if (experiment.status !== 'draft') throw new ConflictException('Experiment already started');
      const pair = [experiment.baselineConfigId, experiment.candidateConfigId];
      // Legacy drafts have never run: freeze their inputs exactly once when first started.
      const snapshot =
        experiment.executionSnapshot ??
        this.queue.snapshot(
          await tx.select().from(configurations).where(inArray(configurations.id, pair)),
        );
      try {
        this.queue.validateSnapshot(snapshot);
      } catch (error) {
        throw new ConflictException((error as Error).message);
      }
      const values: (typeof runs.$inferInsert)[] = [];
      for (let repetition = 1; repetition <= experiment.repetitions; repetition++) {
        experiment.taskIds.forEach((taskId, i) => {
          const order = (i + repetition) % 2 === 0 ? pair : [...pair].reverse();
          for (const configId of order)
            values.push({
              experimentId: id,
              taskId,
              configId,
              repetition,
              position: values.length,
            });
        });
      }
      await tx.insert(runs).values(values);
      await tx
        .update(experiments)
        .set({ status: 'running', startedAt: new Date(), executionSnapshot: snapshot })
        .where(eq(experiments.id, id));
    });
    this.queue.kick();
    return this.get(id);
  }

  async cancel(id: string): Promise<ExperimentSummary> {
    const cancelled = await this.db.transaction(async (tx) => {
      const [experiment] = await tx
        .select()
        .from(experiments)
        .where(eq(experiments.id, id))
        .for('update');
      if (!experiment) throw new NotFoundException(`Experiment ${id} not found`);
      if (experiment.status !== 'running') throw new ConflictException('Experiment is not running');
      await tx
        .update(experiments)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(experiments.id, id));
      return tx
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(and(eq(runs.experimentId, id), inArray(runs.status, ['queued', 'running'])))
        .returning({ id: runs.id });
    });
    this.queue.abort(cancelled.map((run) => run.id));
    return this.get(id);
  }

  /** Retry errors in their current phase; completed conversations are retained for grading. */
  async retryErrors(id: string): Promise<ExperimentSummary> {
    await this.db.transaction(async (tx) => {
      const [experiment] = await tx
        .select()
        .from(experiments)
        .where(eq(experiments.id, id))
        .for('update');
      if (!experiment) throw new NotFoundException(`Experiment ${id} not found`);
      if (!['running', 'finished'].includes(experiment.status))
        throw new ConflictException('Experiment cannot be retried');
      try {
        this.queue.validateSnapshot(experiment.executionSnapshot);
      } catch (error) {
        throw new ConflictException((error as Error).message);
      }
      if (await this.queue.budgetReached(tx, id))
        throw new ConflictException(
          'Experiment spend has reached its cost cap; no more work can start',
        );
      const retried = await tx
        .update(runs)
        .set({
          status: 'queued',
          phaseAttempts: 0,
          errorKind: null,
          errorDetail: null,
          finishedAt: null,
          availableAt: new Date(),
        })
        .where(and(eq(runs.experimentId, id), eq(runs.status, 'error')))
        .returning({ id: runs.id });
      if (retried.length)
        await tx
          .update(experiments)
          .set({ status: 'running', finishedAt: null })
          .where(eq(experiments.id, id));
    });
    this.queue.kick();
    return this.get(id);
  }

  async list(): Promise<ExperimentSummary[]> {
    const rows = await this.db.select().from(experiments).orderBy(desc(experiments.createdAt));
    return Promise.all(rows.map((row) => this.summary(row)));
  }

  async get(id: string): Promise<ExperimentSummary> {
    return this.summary(await this.row(id));
  }

  async costs(id: string) {
    const experiment = await this.row(id);
    const records = await this.db
      .select({
        configId: runs.configId,
        attempts: runs.attempts,
        inputTokens: runs.inputTokens,
        outputTokens: runs.outputTokens,
        costUsd: runs.costUsd,
        costStatus: runs.costStatus,
        leadCostUsd: runs.leadCostUsd,
        judgeCostUsd: runs.judgeCostUsd,
        gradingUsage: runs.gradingUsage,
        context: runs.context,
        judge: runs.judge,
      })
      .from(runs)
      .where(eq(runs.experimentId, id));
    return costBreakdown(experiment, records);
  }

  async runs(id: string): Promise<RunSummary[]> {
    await this.row(id);
    const rows = await this.db
      .select({
        id: runs.id,
        taskId: runs.taskId,
        configId: runs.configId,
        repetition: runs.repetition,
        status: runs.status,
        attempts: runs.attempts,
        passed: runs.passed,
        score: runs.score,
        errorKind: runs.errorKind,
        errorDetail: runs.errorDetail,
        costUsd: runs.costUsd,
        durationMs: runs.durationMs,
      })
      .from(runs)
      .where(eq(runs.experimentId, id))
      .orderBy(asc(runs.position));
    return rows as RunSummary[];
  }

  /** Everything the run inspector shows. */
  async run(runId: string) {
    const [run] = await this.db.select().from(runs).where(eq(runs.id, runId));
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, run.taskId));
    const [configuration] = await this.db
      .select()
      .from(configurations)
      .where(eq(configurations.id, run.configId));
    const events = await this.db
      .select({ payload: runEvents.payload })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.seq));
    const checks = await this.db
      .select()
      .from(checkResults)
      .where(eq(checkResults.runId, runId))
      .orderBy(asc(checkResults.id));
    return {
      run,
      task,
      configuration,
      events: events.map((e) => e.payload),
      checks: checks.map(({ id: _id, runId: _runId, ...check }) => check),
    };
  }

  /** Compare immutable source/result records, including the check evidence behind every flip. */
  async gradeChanges(id: string): Promise<GradeChangeReport | null> {
    const experiment = await this.row(id);
    const replay = (experiment.analysis as ExperimentSummary | null)?.rescoring;
    if (!replay) return null;
    const records = await this.db
      .select()
      .from(runs)
      .where(inArray(runs.experimentId, [id, replay.sourceExperimentId]));
    const current = records.filter((r) => r.experimentId === id);
    const originals = new Map(
      records.filter((r) => r.experimentId === replay.sourceExperimentId).map((r) => [r.id, r]),
    );
    const taskRows = await this.db
      .select()
      .from(tasks)
      .where(inArray(tasks.id, experiment.taskIds));
    const checks = records.length
      ? await this.db
          .select()
          .from(checkResults)
          .where(
            inArray(
              checkResults.runId,
              records.map((r) => r.id),
            ),
          )
      : [];
    const changes: RunGradeChange[] = [];
    let unmatchedRuns = 0;
    for (const run of current) {
      const sourceId = (run.context as { rescoring?: { sourceRunId: string } } | null)?.rescoring
        ?.sourceRunId;
      const original = sourceId ? originals.get(sourceId) : undefined;
      if (
        !original ||
        original.taskId !== run.taskId ||
        original.configId !== run.configId ||
        original.repetition !== run.repetition
      ) {
        unmatchedRuns++;
        continue;
      }
      if (original.passed === run.passed && original.score === run.score) continue;
      const previous = checks.filter((c) => c.runId === original.id && !c.informational);
      const next = checks.filter((c) => c.runId === run.id && !c.informational);
      const checkIds = [...new Set([...previous, ...next].map((c) => c.checkId))];
      const snapshot = (c: (typeof checks)[number] | undefined) =>
        c
          ? {
              passed: c.passed,
              skipped: c.skipped,
              detail: c.detail,
              evidence: c.evidence as import('@evals/shared').Evidence[],
            }
          : null;
      const task = taskRows.find((t) => t.id === run.taskId)!;
      changes.push({
        runId: run.id,
        sourceRunId: original.id,
        taskId: run.taskId,
        taskKey: task.key,
        taskTitle: task.title,
        side: run.configId === experiment.baselineConfigId ? 'A' : 'B',
        repetition: run.repetition,
        previousPassed: original.passed,
        passed: run.passed,
        previousScore: original.score,
        score: run.score,
        reasons: checkIds.flatMap((checkId) => {
          const before = previous.find((c) => c.checkId === checkId),
            after = next.find((c) => c.checkId === checkId);
          if (before?.passed === after?.passed && before?.skipped === after?.skipped) return [];
          const check = after ?? before!;
          return [
            {
              checkId,
              label: check.label,
              critical: check.critical,
              previous: snapshot(before),
              current: snapshot(after),
            },
          ];
        }),
      });
    }
    const priority = (r: RunGradeChange) =>
      r.previousPassed === true && r.passed === false
        ? 0
        : r.previousPassed === false && r.passed === true
          ? 1
          : 2;
    changes.sort(
      (a, b) =>
        priority(a) - priority(b) ||
        a.taskKey.localeCompare(b.taskKey) ||
        a.side.localeCompare(b.side) ||
        a.repetition - b.repetition,
    );
    return {
      sourceExperimentId: replay.sourceExperimentId,
      evaluatorVersion: replay.evaluatorVersion,
      mode: replay.mode ?? 'historical',
      comparedRuns: current.length - unmatchedRuns,
      unmatchedRuns,
      passToFail: changes.filter((r) => r.previousPassed === true && r.passed === false).length,
      failToPass: changes.filter((r) => r.previousPassed === false && r.passed === true).length,
      scoreOnlyChanges: changes.filter((r) => r.previousPassed === r.passed).length,
      unchanged: current.length - unmatchedRuns - changes.length,
      changes,
    };
  }

  private async row(id: string): Promise<ExperimentRow> {
    const [row] = await this.db.select().from(experiments).where(eq(experiments.id, id));
    if (!row) throw new NotFoundException(`Experiment ${id} not found`);
    return row;
  }

  private async summary(row: ExperimentRow): Promise<ExperimentSummary> {
    const records = await this.db
      .select({
        taskId: runs.taskId,
        configId: runs.configId,
        passed: runs.passed,
        score: runs.score,
        repetition: runs.repetition,
        status: runs.status,
      })
      .from(runs)
      .where(eq(runs.experimentId, row.id));
    const scored = records.filter(
      (r) => r.status === 'scored' && r.passed !== null && r.score !== null,
    );
    const grouped = await this.db
      .select({
        status: runs.status,
        n: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(coalesce(cost_usd, 0) + coalesce(lead_cost_usd, 0) + coalesce(judge_cost_usd, 0)), 0)::float`,
      })
      .from(runs)
      .where(eq(runs.experimentId, row.id))
      .groupBy(runs.status);
    const counts = { ...EMPTY_COUNTS };
    let costUsd = 0;
    for (const g of grouped) {
      counts[g.status] = g.n;
      costUsd += g.cost;
    }
    return {
      rescoring: (row.analysis as ExperimentSummary | null)?.rescoring,
      correctedExperimentId: (row.analysis as ExperimentSummary | null)?.correctedExperimentId,
      result: records.some((record) => record.status === 'scored')
        ? compare(
            row.taskIds.map((taskId) => ({
              taskId,
              a: scored
                .filter((r) => r.taskId === taskId && r.configId === row.baselineConfigId)
                .map((r) => r.passed!),
              b: scored
                .filter((r) => r.taskId === taskId && r.configId === row.candidateConfigId)
                .map((r) => r.passed!),
            })),
            {
              plannedTasks: row.taskIds.length,
              plannedRepetitions: row.repetitions,
              experimentStatus: row.status,
              coverageComplete: hasCompleteRunCoverage(
                records,
                row.taskIds,
                [row.baselineConfigId, row.candidateConfigId],
                row.repetitions,
              ),
            },
          )
        : null,
      id: row.id,
      name: row.name,
      hypothesis: row.hypothesis,
      status: row.status,
      baselineConfigId: row.baselineConfigId,
      candidateConfigId: row.candidateConfigId,
      taskIds: row.taskIds,
      repetitions: row.repetitions,
      leadMode: row.leadMode,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      counts,
      costUsd,
    };
  }
}
