import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfigurationSpec, ProgressEvent, RunErrorKind, TaskDefinition } from '@evals/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { Subject } from 'rxjs';
import { loadConfig } from '../config.js';
import { DB, type Db } from '../db/db.module.js';
import { checkResults, configurations, experiments, runEvents, runs, tasks } from '../db/schema.js';
import { SkillsService } from '../skills/skills.service.js';
import { InfraError } from './hermes-cli.js';
import { Judge } from '../scoring/judge.js';
import { GroundingSeverityClassifier, typeSafeClient } from '../scoring/grounding-severity.js';
import { claudeClient } from './anthropic.js';
import { executeRun, type ExecutorSettings, type RunOutcome } from './run-executor.js';

type RunRow = typeof runs.$inferSelect;

/** Seconds to wait before retrying an attempt that failed for infrastructure reasons. */
export function backoffSeconds(kind: InfraError['kind'], attempt: number): number {
  return kind === 'rate_limit' ? 30 * 2 ** (attempt - 1) : 10;
}

/**
 * The worker. Runs live in Postgres; this claims queued ones (FOR UPDATE SKIP LOCKED, so several
 * workers could share the table), executes them with bounded concurrency and records the outcome.
 * A failed attempt is retried from scratch: every attempt gets a fresh Hermes home and a fresh CRM,
 * so a retry can never double-apply anything.
 */
@Injectable()
export class RunQueueService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RunQueueService.name);
  private readonly config = loadConfig();
  private readonly active = new Map<string, AbortController>();
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;
  /** Overridable in tests (fake Hermes, tiny timeouts, no backoff). */
  settings: ExecutorSettings;
  backoffScale = 1;
  readonly progress = new Subject<ProgressEvent>();

  constructor(
    @Inject(DB) private readonly db: Db,
    skills: SkillsService,
  ) {
    this.settings = {
      hermesBin: this.config.HERMES_BIN,
      runsDir: this.config.RUNS_DIR,
      turnTimeoutMs: this.config.TURN_TIMEOUT_MS,
      runBudgetSeconds: this.config.RUN_BUDGET_SECONDS,
      providerKeys: {
        OPENAI_API_KEY: this.config.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: this.config.ANTHROPIC_API_KEY,
      },
      skillContent: (name) => skills.get(name)?.content,
      leadClient: this.config.ANTHROPIC_API_KEY
        ? claudeClient(this.config.ANTHROPIC_API_KEY)
        : null,
      leadModel: this.config.LEAD_MODEL,
      judge: this.config.ANTHROPIC_API_KEY
        ? new Judge(
            claudeClient(this.config.ANTHROPIC_API_KEY),
            this.config.JUDGE_MODEL,
            this.config.TYPESAFE_API_KEY
              ? new GroundingSeverityClassifier(
                  typeSafeClient(this.config.TYPESAFE_API_KEY),
                  this.config.JEV_MODEL,
                )
              : null,
          )
        : null,
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    // A run still marked running belonged to a process that died; its attempt starts over.
    await this.db.update(runs).set({ status: 'queued' }).where(eq(runs.status, 'running'));
    this.timer = setInterval(() => void this.fill(), 1_000);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    clearInterval(this.timer);
    for (const controller of this.active.values()) controller.abort();
  }

  /** Cancel in-flight runs (their Hermes process groups are killed). */
  abort(runIds: string[]): void {
    for (const id of runIds) this.active.get(id)?.abort();
  }

  /** Start runs until the concurrency limit is reached or the queue is empty. */
  async fill(): Promise<void> {
    while (!this.stopping && this.active.size < this.config.RUN_CONCURRENCY) {
      const run = await this.claim();
      if (!run) return;
      const controller = new AbortController();
      this.active.set(run.id, controller);
      this.emit(run.experimentId, run.id, 'running');
      void this.process(run, controller.signal).finally(() => this.active.delete(run.id));
    }
  }

  /** Resolves once nothing is running or queued for `experimentId` (used by tests and the CLI). */
  async drain(experimentId: string): Promise<void> {
    for (;;) {
      await this.fill();
      const [{ open }] = (await this.db
        .select({ open: sql<number>`count(*)::int` })
        .from(runs)
        .where(
          and(eq(runs.experimentId, experimentId), inArray(runs.status, ['queued', 'running'])),
        )) as [{ open: number }];
      if (open === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  private async claim(): Promise<RunRow | undefined> {
    const result = await this.db.execute<{ id: string }>(sql`
      update runs set status = 'running', attempts = attempts + 1, started_at = now()
      where id = (
        select r.id from runs r join experiments e on e.id = r.experiment_id
        where r.status = 'queued' and r.available_at <= now() and e.status = 'running'
        order by r.position
        limit 1
        for update of r skip locked
      )
      returning id`);
    const id = result.rows[0]?.id;
    if (!id) return undefined;
    const [run] = await this.db.select().from(runs).where(eq(runs.id, id));
    return run;
  }

  private async process(run: RunRow, signal: AbortSignal): Promise<void> {
    const [task] = await this.db.select().from(tasks).where(eq(tasks.id, run.taskId));
    const [configuration] = await this.db
      .select()
      .from(configurations)
      .where(eq(configurations.id, run.configId));
    const [experiment] = await this.db
      .select({ leadMode: experiments.leadMode })
      .from(experiments)
      .where(eq(experiments.id, run.experimentId));
    try {
      const outcome = await executeRun(
        {
          runId: run.id,
          attempt: run.attempts,
          task: task!.definition as TaskDefinition,
          spec: configuration!.spec as ConfigurationSpec,
          leadMode: experiment!.leadMode,
          signal,
        },
        this.settings,
      );
      await this.saveOutcome(run, outcome);
      this.emit(run.experimentId, run.id, 'scored');
    } catch (error) {
      const failure =
        error instanceof InfraError
          ? error
          : new InfraError('crash', error instanceof Error ? error.message : String(error));
      if (!(error instanceof InfraError)) this.logger.error(error);
      await this.saveFailure(run, failure);
    } finally {
      // The home's .env holds the provider key; nothing else in the run folder is secret.
      rmSync(join(this.settings.runsDir, run.id, `attempt-${run.attempts}`, 'home', '.env'), {
        force: true,
      });
    }
    await this.afterRun(run.experimentId);
  }

  private async saveOutcome(run: RunRow, outcome: RunOutcome): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx
        .update(runs)
        .set({
          status: 'scored',
          passed: outcome.passed,
          score: outcome.score,
          inputTokens: outcome.inputTokens,
          outputTokens: outcome.outputTokens,
          costUsd: outcome.costUsd,
          costStatus: outcome.costStatus,
          leadCostUsd: outcome.leadUsage?.costUsd ?? null,
          judge: outcome.judge,
          judgeCostUsd: outcome.judge?.usage.costUsd ?? null,
          durationMs: outcome.durationMs,
          sessionIds: outcome.sessionIds,
          crmInitial: outcome.crmInitial,
          crmFinal: outcome.crmFinal,
          context: { ...outcome.context, lead: outcome.leadUsage },
          leadFallbacks: outcome.leadFallbacks,
          errorKind: null,
          errorDetail: null,
          finishedAt: new Date(),
        })
        .where(eq(runs.id, run.id));
      await tx.delete(runEvents).where(eq(runEvents.runId, run.id));
      await tx.delete(checkResults).where(eq(checkResults.runId, run.id));
      if (outcome.events.length) {
        await tx.insert(runEvents).values(
          outcome.events.map((event) => ({
            runId: run.id,
            seq: event.seq,
            session: event.session,
            turn: event.turn,
            kind: event.kind,
            payload: event,
          })),
        );
      }
      await tx
        .insert(checkResults)
        .values(outcome.checks.map((check) => ({ runId: run.id, ...check })));
    });
  }

  private async saveFailure(run: RunRow, failure: InfraError): Promise<void> {
    const log = [
      ...(run.attemptLog as unknown[]),
      { attempt: run.attempts, kind: failure.kind, detail: failure.message, at: new Date() },
    ];
    if (failure.kind === 'cancelled') {
      await this.db
        .update(runs)
        .set({ status: 'cancelled', finishedAt: new Date() })
        .where(eq(runs.id, run.id));
      this.emit(run.experimentId, run.id, 'cancelled');
      return;
    }
    if (failure.retryable && run.attempts < this.config.MAX_ATTEMPTS) {
      const wait = backoffSeconds(failure.kind, run.attempts) * this.backoffScale;
      this.logger.warn(
        `Run ${run.id} attempt ${run.attempts}: ${failure.kind}; retrying in ${wait}s`,
      );
      await this.db
        .update(runs)
        .set({
          status: 'queued',
          attemptLog: log,
          availableAt: sql`now() + make_interval(secs => ${wait})`,
        })
        .where(eq(runs.id, run.id));
      this.emit(run.experimentId, run.id, 'queued');
      return;
    }
    await this.markError([run.id], failure.kind as RunErrorKind, failure.message, log);
    this.emit(run.experimentId, run.id, 'error');
    if (!failure.retryable) {
      // A bad key or an empty balance fails every remaining run the same way: stop them all.
      const queued = await this.db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.experimentId, run.experimentId), eq(runs.status, 'queued')));
      await this.markError(
        queued.map((r) => r.id),
        failure.kind as RunErrorKind,
        `Not run: ${failure.message}`,
      );
    }
  }

  private async markError(
    ids: string[],
    kind: RunErrorKind,
    detail: string,
    attemptLog?: unknown[],
  ): Promise<void> {
    if (!ids.length) return;
    await this.db
      .update(runs)
      .set({
        status: 'error',
        errorKind: kind,
        errorDetail: detail,
        finishedAt: new Date(),
        ...(attemptLog && { attemptLog }),
      })
      .where(inArray(runs.id, ids));
  }

  /** Enforce the cost cap, and close the experiment when nothing is left to run. */
  private async afterRun(experimentId: string): Promise<void> {
    const [stats] = (await this.db
      .select({
        open: sql<number>`count(*) filter (where status in ('queued', 'running'))::int`,
        cost: sql<number>`coalesce(sum(coalesce(cost_usd, 0) + coalesce(lead_cost_usd, 0) + coalesce(judge_cost_usd, 0)), 0)::float`,
      })
      .from(runs)
      .where(eq(runs.experimentId, experimentId))) as [{ open: number; cost: number }];

    if (stats.open > 0 && stats.cost > this.config.MAX_EXPERIMENT_COST_USD) {
      const queued = await this.db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.experimentId, experimentId), eq(runs.status, 'queued')));
      await this.markError(
        queued.map((r) => r.id),
        'cost_cap',
        `Not run: spend reached $${stats.cost.toFixed(2)} (cap $${this.config.MAX_EXPERIMENT_COST_USD})`,
      );
    }
    const [{ open }] = (await this.db
      .select({ open: sql<number>`count(*)::int` })
      .from(runs)
      .where(
        and(eq(runs.experimentId, experimentId), inArray(runs.status, ['queued', 'running'])),
      )) as [{ open: number }];
    if (open > 0) return;
    const closed = await this.db
      .update(experiments)
      .set({ status: 'finished', finishedAt: new Date() })
      .where(and(eq(experiments.id, experimentId), eq(experiments.status, 'running')))
      .returning({ id: experiments.id });
    if (closed.length) this.emit(experimentId, null, 'finished');
  }

  private emit(experimentId: string, runId: string | null, status: ProgressEvent['status']) {
    this.progress.next({ experimentId, runId, status });
  }
}
