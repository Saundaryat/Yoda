import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateExperiment, ExperimentSummary, RunStatus, RunSummary } from '@evals/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { checkResults, configurations, experiments, runEvents, runs, tasks } from '../db/schema.js';
import { RunQueueService } from '../runner/run-queue.service.js';

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
      .select({ id: configurations.id })
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
      .values({ ...input, taskIds })
      .returning();
    return this.summary(row!);
  }

  /**
   * Queue every (task, configuration, repetition) scenario. A and B of the same task and
   * repetition are queued next to each other, alternating which goes first, so a provider slowing
   * down or changing mid-experiment hits both sides alike.
   */
  async start(id: string): Promise<ExperimentSummary> {
    const experiment = await this.row(id);
    if (experiment.status !== 'draft') throw new ConflictException('Experiment already started');
    const pair = [experiment.baselineConfigId, experiment.candidateConfigId];
    const values: (typeof runs.$inferInsert)[] = [];
    for (let repetition = 1; repetition <= experiment.repetitions; repetition++) {
      experiment.taskIds.forEach((taskId, i) => {
        const order = (i + repetition) % 2 === 0 ? pair : [...pair].reverse();
        for (const configId of order) {
          values.push({ experimentId: id, taskId, configId, repetition, position: values.length });
        }
      });
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(runs).values(values);
      await tx
        .update(experiments)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(experiments.id, id));
    });
    void this.queue.fill();
    return this.get(id);
  }

  async cancel(id: string): Promise<ExperimentSummary> {
    const experiment = await this.row(id);
    if (experiment.status !== 'running') throw new ConflictException('Experiment is not running');
    await this.db
      .update(experiments)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(eq(experiments.id, id));
    await this.db
      .update(runs)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(and(eq(runs.experimentId, id), eq(runs.status, 'queued')));
    const running = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.experimentId, id), eq(runs.status, 'running')));
    this.queue.abort(running.map((r) => r.id));
    return this.get(id);
  }

  /** Requeue runs that ended in an error (e.g. after fixing a key or waiting out a rate limit). */
  async retryErrors(id: string): Promise<ExperimentSummary> {
    const experiment = await this.row(id);
    if (experiment.status === 'draft') throw new ConflictException('Experiment has not started');
    const retried = await this.db
      .update(runs)
      .set({
        status: 'queued',
        attempts: 0,
        errorKind: null,
        errorDetail: null,
        availableAt: new Date(),
      })
      .where(and(eq(runs.experimentId, id), eq(runs.status, 'error')))
      .returning({ id: runs.id });
    if (retried.length) {
      await this.db
        .update(experiments)
        .set({ status: 'running', finishedAt: null })
        .where(eq(experiments.id, id));
      void this.queue.fill();
    }
    return this.get(id);
  }

  async list(): Promise<ExperimentSummary[]> {
    const rows = await this.db.select().from(experiments).orderBy(desc(experiments.createdAt));
    return Promise.all(rows.map((row) => this.summary(row)));
  }

  async get(id: string): Promise<ExperimentSummary> {
    return this.summary(await this.row(id));
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

  private async row(id: string): Promise<ExperimentRow> {
    const [row] = await this.db.select().from(experiments).where(eq(experiments.id, id));
    if (!row) throw new NotFoundException(`Experiment ${id} not found`);
    return row;
  }

  private async summary(row: ExperimentRow): Promise<ExperimentSummary> {
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
